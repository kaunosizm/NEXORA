(() => {
  const cfg = window.NEXORA_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const toast = (message) => {
    const el = $("toast"); el.textContent = message; el.classList.add("show");
    clearTimeout(window.__nexoraToast); window.__nexoraToast = setTimeout(() => el.classList.remove("show"), 2800);
  };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const when = (value) => {
    const d = new Date(value); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("tr-TR",{dateStyle:"medium",timeStyle:"short"});
  };
  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) {
    $("connection-state").innerHTML = "<i></i> Yapılandırma eksik";
    $("feed-list").innerHTML = '<div class="loading">Supabase bağlantı ayarları bulunamadı. config.js dosyasını kontrol edin.</div>';
    return;
  }
  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);
  const FOUNDER_UID = "242245a8-acf0-489a-9ba4-e9e4c1593f19";
  let user = null, profile = null, authMode = "signup", activeCommunity = null, roomChannel = null, mediaRecorder = null, recordingChunks = [], authRevision = 0;
  const setConnection = (ok, label) => {
    $("connection-state").innerHTML = "<i></i> " + esc(label);
    $("connection-state").style.color = ok ? "var(--green)" : "#f1c77b";
  };
  const showAuth = (mode = "signup") => {
    authMode = mode; $("auth-title").textContent = mode === "signup" ? "Hesabını oluştur." : "Tekrar hoş geldin.";
    $("auth-eyebrow").textContent = mode === "signup" ? "TOPLULUĞA KATIL" : "NEXORA'YA DÖN";
    $("auth-subtitle").textContent = mode === "signup" ? "NEXORA'da kendi alanını keşfet." : "Topluluğun seni bekliyor.";
    $("username-wrap").classList.toggle("hidden", mode !== "signup");
    $("auth-username").required = mode === "signup";
    $("auth-submit").textContent = mode === "signup" ? "Hesap oluştur" : "Giriş yap";
    $("auth-switch-copy").textContent = mode === "signup" ? "Zaten hesabın var mı?" : "Henüz hesabın yok mu?";
    $("auth-switch").textContent = mode === "signup" ? "Giriş yap" : "Hesap oluştur";
    $("auth-message").textContent = "";
    $("auth-dialog").showModal();
  };
  const requireUser = () => { if (!user) { showAuth("signup"); return false; } return true; };
  const setView = (name) => {
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
    document.querySelectorAll(".nav-item").forEach(v => v.classList.toggle("active", v.dataset.view === name));
    if (name === "communities") loadCommunities();
    if (name === "profile") loadProfile();
    if (name === "explore") loadExplore();
    if (name === "admin") loadAdmin();
    window.scrollTo({top:0,behavior:"smooth"});
  };
  document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
  document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => setView(b.dataset.go)));
  $("auth-open").addEventListener("click", () => showAuth("login"));
  $("welcome-login").addEventListener("click", () => showAuth("login"));
  $("welcome-register").addEventListener("click", () => showAuth("signup"));
  $("auth-close").addEventListener("click", () => $("auth-dialog").close());
  $("auth-switch").addEventListener("click", () => showAuth(authMode === "signup" ? "login" : "signup"));
  $("refresh-feed").addEventListener("click", loadFeed);
  $("room-back").addEventListener("click",()=>setView("communities"));
  $("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const email = $("auth-email").value.trim(); const password = $("auth-password").value;
    const button = $("auth-submit"); button.disabled = true; $("auth-message").textContent = "İşleniyor...";
    try {
      let result;
      if (authMode === "signup") {
        const username = $("auth-username").value.trim().toLowerCase();
        if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error("Kullanıcı adı 3-24 karakter olmalı; harf, sayı ve _ kullanabilirsin.");
        result = await db.auth.signUp({email,password,options:{data:{username,display_name:username}}});
        if (result.error) throw result.error;
        $("auth-message").textContent = result.data.session ? "Hesabın oluşturuldu!" : "Doğrulama e-postası gönderildi. E-postanı kontrol et.";
        if (result.data.session) $("auth-dialog").close();
      } else {
        result = await db.auth.signInWithPassword({email,password});
        if (result.error) throw result.error;
        $("auth-dialog").close(); toast("Tekrar hoş geldin!");
      }
    } catch (err) { $("auth-message").textContent = err.message || "Bir hata oluştu."; }
    finally { button.disabled = false; }
  });
  $("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault(); if (!requireUser()) return;
    const username = $("profile-username").value.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return toast("Kullanıcı adı 3-24 karakter olmalı.");
    const {error} = await db.from("profiles").update({username,display_name:$("profile-display").value.trim(),bio:$("profile-bio").value.trim()}).eq("id",user.id);
    if (error) return toast(error.message);
    await loadProfile(); toast("Profilin kaydedildi.");
  });
  $("community-form").addEventListener("submit", async (e) => {
    e.preventDefault(); if (!requireUser()) return;
    const name = $("community-name").value.trim();
    const slug = $("community-slug").value.trim().toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");
    if (slug.length < 3) return toast("Topluluk adresi en az 3 karakter olmalı.");
    const {data,error} = await db.from("communities").insert({name,slug,description:$("community-description").value.trim(),created_by:user.id,visibility:"public"}).select("id").single();
    if (error) return toast(error.message);
    const join = await db.from("community_members").insert({community_id:data.id,user_id:user.id,role:"owner"});
    if (join.error) return toast("Topluluk oluştu ancak üyelik kaydedilemedi: " + join.error.message);
    e.target.reset(); toast("Topluluğun oluşturuldu!"); await loadCommunities();
  });
  async function loadProfile() {
    if (!user) { $("profile-username").value=""; $("profile-display").value=""; $("profile-bio").value=""; return; }
    const {data,error} = await db.from("profiles").select("username,display_name,bio,avatar_url").eq("id",user.id).maybeSingle();
    if (error) return toast(error.message);
    profile = data; if (!data) return;
    $("profile-username").value = data.username || "";
    $("profile-display").value = data.display_name || "";
    $("profile-bio").value = data.bio || "";
    $("profile-avatar").textContent = (data.display_name || data.username || "N").slice(0,1).toUpperCase();
    $("profile-avatar-image").classList.toggle("hidden",!data.avatar_url);
    $("profile-avatar").classList.toggle("hidden",!!data.avatar_url);
    if(data.avatar_url) $("profile-avatar-image").src=data.avatar_url;
  }
  function authorLabel(p) { const founder=p.id==="242245a8-acf0-489a-9ba4-e9e4c1593f19"; return `<span class="${founder?"founder-name":""}">${esc(p.display_name||p.username||"NEXORA üyesi")}</span>${founder?' <span class="founder-badge" title="NEXORA Kurucusu">♛ KURUCU</span>':""}`; }
  function postMarkup(post) {
    const p = post.profiles || {}; const comments = post.comments || []; const liked = user && (post.post_likes || []).some(x => x.user_id === user.id);
    return `<article class="card post-card" data-post="${post.id}"><div class="post-head">${p.avatar_url?`<img class="post-avatar post-avatar-image" src="${esc(p.avatar_url)}" alt="">`:`<div class="post-avatar">${esc((p.display_name||p.username||"N").slice(0,1).toUpperCase())}</div>`}<div><div class="post-author">${authorLabel(p)}</div><div class="post-meta">@${esc(p.username||"uye")} · ${esc(post.communities?.name||"Topluluk")} · ${esc(when(post.created_at))}</div></div></div><div class="post-content">${esc(post.content)}</div><div class="post-actions"><button class="action-btn ${liked?"liked":""}" data-like>${liked?"♥":"♡"} ${(post.post_likes||[]).length} Beğeni</button><span class="action-btn">▢ ${comments.length} Yorum</span></div><div class="comment-list">${comments.map(c=>`<div class="comment"><strong>@${esc(c.profiles?.username||"uye")}</strong>${esc(c.content)}</div>`).join("")}</div><form class="comment-form"><input maxlength="500" placeholder="Yorumunu yaz..." aria-label="Yorum"><button type="submit">Gönder</button></form></article>`;
  }
  async function fetchPosts() {
    const {data,error} = await db.from("posts").select("id,content,created_at,author_id,community_id,profiles!posts_author_id_fkey(id,username,display_name,avatar_url),communities!posts_community_id_fkey(name),post_likes(user_id),comments(id,content,created_at,profiles!comments_author_id_fkey(id,username,display_name))").not("community_id","is",null).order("created_at",{ascending:false}).limit(40);
    if (error) throw error; return data || [];
  }
  function bindPostActions(root) {
    root.querySelectorAll("[data-post]").forEach(card => {
      const postId = card.dataset.post;
      card.querySelector("[data-like]")?.addEventListener("click", async () => {
        if (!requireUser()) return;
        const {data:existing,error:checkError} = await db.from("post_likes").select("post_id").eq("post_id",postId).eq("user_id",user.id).maybeSingle();
        if (checkError) return toast(checkError.message);
        const result = existing ? await db.from("post_likes").delete().eq("post_id",postId).eq("user_id",user.id) : await db.from("post_likes").insert({post_id:postId,user_id:user.id});
        if (result.error) return toast(result.error.message); await loadFeed();
      });
      card.querySelector(".comment-form")?.addEventListener("submit", async (e) => {
        e.preventDefault(); if (!requireUser()) return;
        const input = e.currentTarget.querySelector("input"); const content = input.value.trim(); if (!content) return;
        const {error} = await db.from("comments").insert({post_id:postId,author_id:user.id,content});
        if (error) return toast(error.message); await loadFeed();
      });
    });
  }
  async function loadFeed() {
    $("feed-list").innerHTML = '<div class="loading">Akış yükleniyor...</div>';
    try { const posts = await fetchPosts(); $("feed-list").innerHTML = posts.length ? posts.map(postMarkup).join("") : '<div class="card loading">Henüz paylaşım yok. İlk gönderiyi sen paylaş!</div>'; bindPostActions($("feed-list")); $("side-post-count").textContent = posts.length; }
    catch (err) { $("feed-list").innerHTML = '<div class="card loading">Akış yüklenemedi: '+esc(err.message)+'</div>'; }
  }
  async function loadExplore() {
    try { const posts = await fetchPosts(); $("explore-feed").innerHTML = posts.length ? posts.slice(0,12).map(postMarkup).join("") : '<div class="card loading">Keşfedilecek ilk paylaşımı sen yap!</div>'; bindPostActions($("explore-feed")); }
    catch (err) { $("explore-feed").innerHTML = '<div class="loading">'+esc(err.message)+'</div>'; }
  }
  async function loadCommunities() {
    $("community-list").innerHTML = '<div class="loading">Topluluklar yükleniyor...</div>';
    const {data,error} = await db.from("communities").select("id,name,slug,description,created_at,created_by").eq("visibility","public").order("created_at",{ascending:false}).limit(60);
    if (error) { $("community-list").innerHTML = '<div class="loading">'+esc(error.message)+'</div>'; return; }
    $("community-count").textContent = (data||[]).length+" topluluk";
    $("side-community-count").textContent = (data||[]).length;
    if (!data?.length) { $("community-list").innerHTML = '<div class="card loading">Henüz topluluk yok. İlk topluluğu sen oluştur!</div>'; return; }
    let joined = new Set();
    if (user) { const {data:members} = await db.from("community_members").select("community_id").eq("user_id",user.id); joined = new Set((members||[]).map(m=>m.community_id)); }
    $("community-list").innerHTML = data.map((c,i)=>`<article class="card community-card"><div class="community-symbol">${["✦","◈","⌘","✧"][i%4]}</div><h3>${esc(c.name)}</h3><p>${esc(c.description||"Bu toplulukta yeni fikirler keşfet.")}</p><small>/c/${esc(c.slug)}</small><div class="community-card-actions">${joined.has(c.id)?`<button class="btn btn-primary" data-open-community="${c.id}">Topluluğu aç ↗</button>`:`<button class="btn btn-quiet" data-join="${c.id}">Topluluğa katıl +</button>`}</div></article>`).join("");
    $("community-list").querySelectorAll("[data-open-community]").forEach(btn=>btn.addEventListener("click",()=>openCommunity(data.find(c=>c.id===btn.dataset.openCommunity))));
    $("community-list").querySelectorAll("[data-join]").forEach(btn=>btn.addEventListener("click",async()=>{
      if(!requireUser())return; const {error:joinError}=await db.from("community_members").insert({community_id:btn.dataset.join,user_id:user.id,role:"member"});
      if(joinError && !joinError.message.includes("duplicate"))return toast(joinError.message);
      toast("Topluluğa katıldın!"); loadCommunities();
    }));
  }
  async function updateAuth(session) {
    const revision = ++authRevision;
    user = session?.user || null;
    $("welcome-screen").classList.toggle("hidden",!!user);
    document.querySelector(".layout").classList.toggle("hidden",!user);
    $("auth-open").classList.add("hidden"); $("user-chip").classList.toggle("hidden",!user);
    if (user) {
      const {data,error:profileError} = await db.from("profiles").select("id,username,display_name").eq("id",user.id).maybeSingle();
      if (revision !== authRevision) return;
      if (profileError) console.error("NEXORA profile lookup:",profileError);
      profile = data; $("user-chip").innerHTML = data?.id===FOUNDER_UID ? '<span class="founder-name">@'+esc(data.username||"kurucu")+'</span> <span class="founder-badge">♛</span>' : "@"+esc(data?.username || user.email?.split("@")[0] || "üye");
      $("admin-nav").classList.toggle("hidden",user.id!==FOUNDER_UID);
      $("user-chip").title = "Çıkış yap"; $("user-chip").style.cursor="pointer";
      $("user-chip").onclick = async()=>{if(confirm("Çıkış yapmak istiyor musun?")){await db.auth.signOut();toast("Çıkış yapıldı.");}};
    } else { profile=null; $("user-chip").onclick=null; $("admin-nav").classList.add("hidden"); }
    if (revision !== authRevision) return;
    await Promise.all([loadFeed(),loadCommunities()]);
  }
  $("avatar-file").addEventListener("change", async (e)=>{
    if(!requireUser())return; const file=e.target.files?.[0]; if(!file)return;
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>5*1024*1024){e.target.value="";return toast("JPG, PNG veya WebP seç; dosya 5 MB sınırı var.");}
    const path=user.id+"/"+Date.now()+"-"+file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
    const up=await db.storage.from("avatars").upload(path,file,{cacheControl:"3600",upsert:false}); if(up.error)return toast(up.error.message);
    const url=db.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    const saved=await db.from("profiles").update({avatar_url:url}).eq("id",user.id); if(saved.error)return toast(saved.error.message);
    await loadProfile(); toast("Profil fotoğrafın güncellendi."); e.target.value="";
  });

  async function openCommunity(community) {
    if (!community || !requireUser()) return;
    const {data:member,error:memberError}=await db.from("community_members").select("community_id").eq("community_id",community.id).eq("user_id",user.id).maybeSingle();
    if(memberError||!member) return toast("Bu topluluğun üyesi olmalısın.");
    activeCommunity=community;
    $("room-title").textContent=community.name;
    $("room-description").textContent=community.description||"Topluluk üyeleriyle mesajlaş.";
    setView("community-room");
    await loadRoomMessages();
    if(roomChannel) await db.removeChannel(roomChannel);
    roomChannel=db.channel("community-room-"+community.id).on("postgres_changes",{event:"INSERT",schema:"public",table:"community_messages",filter:"community_id=eq."+community.id},()=>loadRoomMessages()).subscribe();
  }
  async function loadRoomMessages() {
    if(!activeCommunity)return;
    const box=$("room-messages"); box.innerHTML='<div class="loading">Mesajlar yükleniyor...</div>';
    const {data,error}=await db.from("community_messages").select("id,author_id,message_type,content,media_path,created_at,profiles!community_messages_author_id_fkey(username,display_name,avatar_url)").eq("community_id",activeCommunity.id).order("created_at",{ascending:true}).limit(150);
    if(error){box.innerHTML='<div class="loading">'+esc(error.message)+'</div>';return;}
    if(!data?.length){box.innerHTML='<div class="room-empty">Henüz mesaj yok. İlk mesajı sen gönder!</div>';return;}
    const rendered=await Promise.all(data.map(async m=>{
      let media="";
      if(m.media_path){const signed=await db.storage.from("community-media").createSignedUrl(m.media_path,3600);if(!signed.error&&signed.data?.signedUrl){media=m.message_type==="image"?'<img class="room-image" src="'+esc(signed.data.signedUrl)+'" alt="Paylaşılan fotoğraf" loading="lazy">':'<audio class="room-audio" controls preload="none" src="'+esc(signed.data.signedUrl)+'"></audio>';}}
      const p=m.profiles||{};const founder=m.author_id===FOUNDER_UID;
      return '<article class="room-message">'+(p.avatar_url?'<img class="room-avatar" src="'+esc(p.avatar_url)+'" alt="">':'<div class="room-avatar">'+esc((p.display_name||p.username||"N").slice(0,1).toUpperCase())+'</div>')+'<div class="room-message-body"><div class="room-message-head"><strong class="'+(founder?'founder-name':'')+'">'+esc(p.display_name||p.username||"Üye")+'</strong> '+(founder?'<span class="founder-badge">♛ KURUCU</span>':'')+' <small>@'+esc(p.username||"uye")+' · '+esc(when(m.created_at))+'</small></div>'+(m.content?'<p>'+esc(m.content)+'</p>':'')+media+'</div></article>';
    }));
    box.innerHTML=rendered.join("");box.scrollTop=box.scrollHeight;
  }
  async function sendRoomMessage(fileOverride=null) {
    if(!activeCommunity||!requireUser())return;
    const content=$("room-message").value.trim();const file=fileOverride||$("room-file").files?.[0];
    if(!content&&!file)return toast("Mesaj yaz veya fotoğraf/ses ekle.");
    let message_type="text",media_path=null;
    if(file){
      if(file.type.startsWith("image/"))message_type="image";else if(file.type.startsWith("audio/"))message_type="audio";else return toast("Yalnızca fotoğraf veya ses dosyası gönderebilirsin.");
      if(file.size>10*1024*1024)return toast("Dosya en fazla 10 MB olabilir.");
      const safeName=file.name?file.name.replace(/[^a-zA-Z0-9._-]/g,"_"):"voice-note.webm";
      media_path=activeCommunity.id+"/"+user.id+"/"+Date.now()+"-"+safeName;
      const upload=await db.storage.from("community-media").upload(media_path,file,{cacheControl:"3600",upsert:false,contentType:file.type.split(";")[0]});
      if(upload.error)return toast(upload.error.message);
    }
    const {error}=await db.from("community_messages").insert({community_id:activeCommunity.id,author_id:user.id,message_type,content,media_path});
    if(error)return toast(error.message);
    $("room-message").value="";$("room-file").value="";if(fileOverride)toast("Sesli mesaj gönderildi.");await loadRoomMessages();
  }
  $("room-form").addEventListener("submit",async e=>{e.preventDefault();await sendRoomMessage();});
  $("room-file").addEventListener("change",e=>{if(e.target.files?.[0])toast("Dosya hazır. Göndermek için Gönder'e bas.");});
  $("record-audio").addEventListener("click",async()=>{
    if(!requireUser())return;
    if(mediaRecorder?.state==="recording"){mediaRecorder.stop();$("record-audio").textContent="● Ses kaydet";$("record-status").textContent="Ses hazırlanıyor...";return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return toast("Bu tarayıcı ses kaydını desteklemiyor.");
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      mediaRecorder=new MediaRecorder(stream);recordingChunks=[];
      mediaRecorder.ondataavailable=e=>{if(e.data.size)recordingChunks.push(e.data);};
      mediaRecorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(recordingChunks,{type:mediaRecorder.mimeType||"audio/webm"});const ext=blob.type.includes("ogg")?"ogg":blob.type.includes("mp4")?"m4a":"webm";const voice=new File([blob],"voice-note-"+Date.now()+"."+ext,{type:blob.type});$("record-status").textContent="";await sendRoomMessage(voice);};
      mediaRecorder.start();$("record-audio").textContent="■ Kaydı bitir";$("record-status").textContent="Ses kaydediliyor...";
    }catch(err){toast("Mikrofon izni alınamadı: "+err.message);}
  });
  async function loadAdmin(){
    if(!user||user.id!==FOUNDER_UID)return;
    const items=[["Üyeler","profiles"],["Topluluklar","communities"],["Topluluk mesajları","community_messages"],["Paylaşımlar","posts"]];
    const stats=await Promise.all(items.map(async x=>{const r=await db.from(x[1]).select("*",{count:"exact",head:true});return {label:x[0],count:r.count,error:r.error};}));
    $("admin-stats").innerHTML=stats.map(x=>'<div class="card admin-stat"><span>'+esc(x.label)+'</span><strong>'+(x.error?"—":x.count)+'</strong></div>').join("");
    const members=await db.from("profiles").select("id,username,display_name,created_at").order("created_at",{ascending:false}).limit(12);
    $("admin-member-list").innerHTML=members.error?'<div class="loading">'+esc(members.error.message)+'</div>':(members.data||[]).map(m=>'<div class="admin-member"><div><strong>'+esc(m.display_name||m.username)+'</strong> '+(m.id===FOUNDER_UID?'<span class="founder-badge">♛ KURUCU</span>':'')+'<small>@'+esc(m.username)+'</small></div><time>'+esc(when(m.created_at))+'</time></div>').join("")||'<div class="loading">Henüz üye yok.</div>';
  }
  // Supabase auth callback içinde başka Supabase sorgusu çalıştırma: kilitlenmeyi önlemek için sonraki göreve bırak.
  db.auth.onAuthStateChange((_event,session)=>{
    window.setTimeout(()=>{ updateAuth(session).catch(err=>{ console.error("NEXORA auth update:",err); toast("Oturum güncellenemedi. Sayfayı yenilemeyi dene."); }); },0);
  });
  (async()=>{
    try {
      const {data,error}=await db.auth.getSession();
      if(error)throw error;
      setConnection(true,"Supabase bağlı");
      await updateAuth(data.session);
    } catch(err) {
      setConnection(false,"Bağlantı hatası");
      $("feed-list").innerHTML='<div class="loading">'+esc(err.message)+'</div>';
      console.error("NEXORA session bootstrap:",err);
    }
  })();
})();