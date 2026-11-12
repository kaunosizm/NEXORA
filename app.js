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
  let user = null, profile = null, authMode = "signup";
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
    window.scrollTo({top:0,behavior:"smooth"});
  };
  document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
  document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => setView(b.dataset.go)));
  $("auth-open").addEventListener("click", () => showAuth("login"));
  $("auth-close").addEventListener("click", () => $("auth-dialog").close());
  $("auth-switch").addEventListener("click", () => showAuth(authMode === "signup" ? "login" : "signup"));
  $("refresh-feed").addEventListener("click", loadFeed);
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
  $("publish-post").addEventListener("click", async () => {
    if (!requireUser()) return;
    const content = $("post-content").value.trim(); if (!content) return toast("Önce bir şeyler yaz.");
    const {error} = await db.from("posts").insert({author_id:user.id,content});
    if (error) return toast(error.message);
    $("post-content").value = ""; toast("Paylaşımın yayınlandı."); await loadFeed();
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
    const {data,error} = await db.from("profiles").select("username,display_name,bio").eq("id",user.id).maybeSingle();
    if (error) return toast(error.message);
    profile = data; if (!data) return;
    $("profile-username").value = data.username || "";
    $("profile-display").value = data.display_name || "";
    $("profile-bio").value = data.bio || "";
    $("profile-avatar").textContent = (data.display_name || data.username || "N").slice(0,1).toUpperCase();
  }
  function postMarkup(post) {
    const p = post.profiles || {}; const comments = post.comments || []; const liked = user && (post.post_likes || []).some(x => x.user_id === user.id);
    return `<article class="card post-card" data-post="${post.id}"><div class="post-head"><div class="post-avatar">${esc((p.display_name||p.username||"N").slice(0,1).toUpperCase())}</div><div><div class="post-author">${esc(p.display_name||p.username||"NEXORA üyesi")}</div><div class="post-meta">@${esc(p.username||"uye")} · ${esc(when(post.created_at))}</div></div></div><div class="post-content">${esc(post.content)}</div><div class="post-actions"><button class="action-btn ${liked?"liked":""}" data-like>${liked?"♥":"♡"} ${(post.post_likes||[]).length} Beğeni</button><span class="action-btn">▢ ${comments.length} Yorum</span></div><div class="comment-list">${comments.map(c=>`<div class="comment"><strong>@${esc(c.profiles?.username||"uye")}</strong>${esc(c.content)}</div>`).join("")}</div><form class="comment-form"><input maxlength="500" placeholder="Yorumunu yaz..." aria-label="Yorum"><button type="submit">Gönder</button></form></article>`;
  }
  async function fetchPosts() {
    const {data,error} = await db.from("posts").select("id,content,created_at,author_id,profiles!posts_author_id_fkey(username,display_name),post_likes(user_id),comments(id,content,created_at,profiles!comments_author_id_fkey(username,display_name))").order("created_at",{ascending:false}).limit(40);
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
    $("community-list").innerHTML = data.map((c,i)=>`<article class="card community-card"><div class="community-symbol">${["✦","◈","⌘","✧"][i%4]}</div><h3>${esc(c.name)}</h3><p>${esc(c.description||"Bu toplulukta yeni fikirler keşfet.")}</p><small>/c/${esc(c.slug)}</small><button class="btn ${joined.has(c.id)?"btn-quiet":"btn-primary"}" data-join="${c.id}" ${joined.has(c.id)?"disabled":""}>${joined.has(c.id)?"Katıldın ✓":"Topluluğa katıl +"}</button></article>`).join("");
    $("community-list").querySelectorAll("[data-join]").forEach(btn=>btn.addEventListener("click",async()=>{
      if(!requireUser())return; const {error:joinError}=await db.from("community_members").insert({community_id:btn.dataset.join,user_id:user.id,role:"member"});
      if(joinError && !joinError.message.includes("duplicate"))return toast(joinError.message);
      toast("Topluluğa katıldın!"); loadCommunities();
    }));
  }
  async function updateAuth(session) {
    user = session?.user || null;
    $("auth-open").classList.toggle("hidden",!!user); $("user-chip").classList.toggle("hidden",!user);
    if (user) {
      const {data} = await db.from("profiles").select("username,display_name").eq("id",user.id).maybeSingle();
      profile = data; $("user-chip").textContent = "@"+(data?.username || "üye");
      $("user-chip").title = "Çıkış yap"; $("user-chip").style.cursor="pointer";
      $("user-chip").onclick = async()=>{if(confirm("Çıkış yapmak istiyor musun?")){await db.auth.signOut();toast("Çıkış yapıldı.");}};
    } else { profile=null; $("user-chip").onclick=null; }
    await Promise.all([loadFeed(),loadCommunities()]);
  }
  db.auth.onAuthStateChange((_event,session)=>{ updateAuth(session); });
  (async()=>{
    try { const {data,error}=await db.auth.getSession(); if(error)throw error; setConnection(true,"Supabase bağlı"); await updateAuth(data.session); }
    catch(err){setConnection(false,"Bağlantı hatası");$("feed-list").innerHTML='<div class="loading">'+esc(err.message)+'</div>';}
  })();
})();