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
    $("home-community-list").innerHTML = '<div class="loading">Supabase bağlantı ayarları bulunamadı. config.js dosyasını kontrol edin.</div>';
    return;
  }
  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);
  const FOUNDER_UID = "242245a8-acf0-489a-9ba4-e9e4c1593f19";
  let user = null, profile = null, authMode = "signup", activeCommunity = null, activeChannel = null, activeRoom = null, communityChannels = [], communityRooms = [], communityMembers = [], communityRole = "member", communityChannelError = null, roomChannel = null, mediaRecorder = null, recordingChunks = [], authRevision = 0, mfaSetupFactorId = null, mfaSetupChallengeId = null, mfaLoginActive = false, activeDm = null, dmChannel = null;
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
    const appLayout=document.querySelector(".layout");appLayout.classList.toggle("community-mode",name==="community-room");appLayout.classList.remove("community-nav-open");if($("community-menu-toggle"))$("community-menu-toggle").setAttribute("aria-expanded","false");
    if (name === "home") loadHome();
    if (name === "communities") loadCommunities();
    if (name === "friends") loadFriends();
    if (name === "messages") loadMessages();
    if (name === "profile") loadProfile();
    if (name === "settings") loadSettings();
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
  $("password-change-form").addEventListener("submit", async (e) => {
    e.preventDefault(); if (!requireUser()) return;
    const currentPassword=$("current-password").value;
    const newPassword=$("new-password").value;
    const confirmPassword=$("confirm-password").value;
    const message=$("password-change-message");
    if(newPassword.length<8){message.textContent="Yeni şifre en az 8 karakter olmalı.";return;}
    if(newPassword!==confirmPassword){message.textContent="Yeni şifreler eşleşmiyor.";return;}
    const button=e.currentTarget.querySelector('button[type="submit"]');button.disabled=true;message.textContent="Şifre doğrulanıyor...";
    try{
      const {error}=await db.auth.updateUser({password:newPassword,current_password:currentPassword});
      if(error)throw error;
      e.currentTarget.reset();message.textContent="Şifren başarıyla güncellendi.";toast("Şifren güncellendi.");
    }catch(err){message.textContent=err.message||"Şifre güncellenemedi.";}
    finally{button.disabled=false;}
  });
  $("mfa-start").addEventListener("click", async()=>{
    if(!requireUser())return;
    $("mfa-start").disabled=true;
    try{
      const {data,error}=await db.auth.mfa.enroll({factorType:"totp",friendlyName:"NEXORA Authenticator"});
      if(error)throw error;
      mfaSetupFactorId=data.id;
      const challenge=await db.auth.mfa.challenge({factorId:data.id});
      if(challenge.error)throw challenge.error;
      mfaSetupChallengeId=challenge.data.id;
      $("mfa-qr").src=data.totp.qr_code;
      $("mfa-secret").textContent=data.totp.secret;
      $("mfa-setup").classList.remove("hidden");
      $("mfa-start").classList.add("hidden");
      $("mfa-status").textContent="Kurulum bekleniyor — uygulamandaki kodu doğrula.";
    }catch(err){toast("2FA başlatılamadı: "+(err.message||"Bilinmeyen hata"));}
    finally{$("mfa-start").disabled=false;}
  });
  $("mfa-verify-form").addEventListener("submit",async e=>{
    e.preventDefault();if(!mfaSetupFactorId||!mfaSetupChallengeId)return;
    const code=$("mfa-setup-code").value.trim();
    if(!/^[0-9]{6}$/.test(code))return toast("6 haneli kodu gir.");
    const {error}=await db.auth.mfa.verify({factorId:mfaSetupFactorId,challengeId:mfaSetupChallengeId,code});
    if(error)return toast("Kod doğrulanamadı: "+error.message);
    mfaSetupFactorId=null;mfaSetupChallengeId=null;$("mfa-setup").classList.add("hidden");$("mfa-setup-code").value="";
    toast("İki faktörlü doğrulama etkinleştirildi.");await loadSettings();
  });
  $("mfa-disable").addEventListener("click",async()=>{
    const factors=await db.auth.mfa.listFactors();
    const factor=(factors.data?.totp||[]).find(x=>x.status==="verified");
    if(!factor)return toast("Etkin doğrulama yöntemi bulunamadı.");
    const code=prompt("Authenticator uygulamandaki 6 haneli kodu gir:");
    if(!code)return;
    if(!/^[0-9]{6}$/.test(code))return toast("Geçerli 6 haneli kod gir.");
    const challenge=await db.auth.mfa.challenge({factorId:factor.id});
    if(challenge.error)return toast(challenge.error.message);
    const verified=await db.auth.mfa.verify({factorId:factor.id,challengeId:challenge.data.id,code});
    if(verified.error)return toast("Kod doğrulanamadı: "+verified.error.message);
    const removed=await db.auth.mfa.unenroll({factorId:factor.id});
    if(removed.error)return toast(removed.error.message);
    toast("İki faktörlü doğrulama kapatıldı.");await loadSettings();
  });
  $("mfa-login-form").addEventListener("submit",async e=>{
    e.preventDefault();
    const factorId=$("mfa-login-form").dataset.factorId;
    const challengeId=$("mfa-login-form").dataset.challengeId;
    const code=$("mfa-login-code").value.trim();
    if(!/^[0-9]{6}$/.test(code)){$("mfa-login-message").textContent="6 haneli kod gir.";return;}
    const button=e.currentTarget.querySelector('button[type="submit"]');button.disabled=true;$("mfa-login-message").textContent="Kod kontrol ediliyor...";
    try{
      const {error}=await db.auth.mfa.verify({factorId,challengeId,code});
      if(error)throw error;
      $("mfa-login-dialog").close();mfaLoginActive=false;$("mfa-login-code").value="";
      await syncAuthState();
    }catch(err){$("mfa-login-message").textContent=err.message||"Kod doğrulanamadı.";}
    finally{button.disabled=false;}
  });
  $("room-back").addEventListener("click",()=>setView("communities"));
  const communityLayout=document.querySelector(".layout");
  const setCommunityMenu=(open)=>{communityLayout.classList.toggle("community-nav-open",open);$("community-menu-toggle").setAttribute("aria-expanded",String(open));};
  $("community-menu-toggle").addEventListener("click",e=>{e.stopPropagation();setCommunityMenu(!communityLayout.classList.contains("community-nav-open"));});
  document.addEventListener("click",e=>{if(communityLayout.classList.contains("community-mode")&&communityLayout.classList.contains("community-nav-open")&&!e.target.closest(".sidebar")&&!e.target.closest("#community-menu-toggle"))setCommunityMenu(false);});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")setCommunityMenu(false);});
  $("sidebar-logout").addEventListener("click",async()=>{if(user&&confirm("Çıkış yapmak istiyor musun?")){await db.auth.signOut();toast("Çıkış yapıldı.");}});

  let globalSearchType="all",globalSearchTimer=null;
  async function showProfileCard(profileId){
    if(!profileId)return;
    const box=$("profile-view-content");
    box.innerHTML='<div class="loading">Profil yükleniyor...</div>';
    if(!$("profile-view-dialog").open)$("profile-view-dialog").showModal();
    const {data:p,error}=await db.from("profiles").select("id,username,display_name,bio,avatar_url,created_at").eq("id",profileId).maybeSingle();
    if(error||!p){box.innerHTML='<p class="empty-note">Profil yüklenemedi.</p>';return;}
    let friendship="none";
    if(user&&user.id!==p.id){
      const [f,r]=await Promise.all([
        db.from("friendships").select("user_a,user_b").or("and(user_a.eq."+user.id+",user_b.eq."+p.id+"),and(user_a.eq."+p.id+",user_b.eq."+user.id+")"),
        db.from("friend_requests").select("sender_id,receiver_id,status").eq("status","pending").or("and(sender_id.eq."+user.id+",receiver_id.eq."+p.id+"),and(sender_id.eq."+p.id+",receiver_id.eq."+user.id+")")
      ]);
      if(f.data?.length)friendship="friends";
      else if(r.data?.length)friendship=r.data[0].sender_id===user.id?"sent":"received";
    }
    const avatar=p.avatar_url?'<img src="'+esc(p.avatar_url)+'" alt="">':esc((p.display_name||p.username||"N").slice(0,1).toUpperCase());
    const action=user&&user.id!==p.id?(friendship==="friends"?'<button class="btn btn-primary" data-profile-message="'+p.id+'">Mesaj gönder</button>':friendship==="sent"?'<span class="request-pending">İstek gönderildi</span>':friendship==="received"?'<span class="request-pending">Sana istek gönderdi</span>':'<button class="btn btn-primary" data-profile-add="'+p.id+'">Arkadaş ekle +</button>'):"";
    box.innerHTML='<div class="profile-view-hero"><div class="profile-view-avatar">'+avatar+'</div><div><div class="eyebrow">NEXORA PROFİLİ</div><h2>'+esc(p.display_name||p.username)+'</h2><p>@'+esc(p.username)+'</p></div></div><div class="profile-view-bio">'+esc(p.bio||"Bu kullanıcı henüz bir biyografi eklememiş.")+'</div><div class="profile-view-meta"><span>Katılma tarihi</span><strong>'+esc(when(p.created_at))+'</strong></div><div class="profile-view-actions">'+action+'</div>';
    box.querySelector("[data-profile-add]")?.addEventListener("click",async()=>{const r=await db.from("friend_requests").insert({sender_id:user.id,receiver_id:p.id});if(r.error)return toast(r.error.message);toast("Arkadaşlık isteği gönderildi.");showProfileCard(p.id);loadFriends();});
    box.querySelector("[data-profile-message]")?.addEventListener("click",async()=>{$("profile-view-dialog").close();setView("messages");await openDm(p);});
  }
  document.addEventListener("click",e=>{const el=e.target.closest("[data-profile-view]");if(el){e.preventDefault();if($("global-search-dialog").open)$("global-search-dialog").close();showProfileCard(el.dataset.profileView);}});
  $("global-search-open").addEventListener("click",()=>{$("global-search-dialog").showModal();$("global-search-input").focus();});
  $("global-search-close").addEventListener("click",()=>$("global-search-dialog").close());
  $("global-search-dialog").addEventListener("click",e=>{if(e.target===$("global-search-dialog"))$("global-search-dialog").close();});
  document.querySelectorAll("[data-search-type]").forEach(b=>b.addEventListener("click",()=>{globalSearchType=b.dataset.searchType;document.querySelectorAll("[data-search-type]").forEach(x=>x.classList.toggle("active",x===b));performGlobalSearch();}));
  $("global-search-input").addEventListener("input",()=>{clearTimeout(globalSearchTimer);globalSearchTimer=setTimeout(performGlobalSearch,220);});
  document.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();$("global-search-dialog").showModal();$("global-search-input").focus();}});
  async function performGlobalSearch(){
    const raw=$("global-search-input").value.trim(),term=raw.replace(/^@/,"").replace(/[%_,()]/g," ").replace(/\s+/g," ").trim(),box=$("global-search-results");
    if(term.length<2){box.innerHTML='<p class="empty-note">Aramaya başlamak için en az 2 karakter yaz.</p>';return;}
    box.innerHTML='<p class="empty-note">Aranıyor...</p>';
    const wantsProfiles=globalSearchType!=="communities",wantsCommunities=globalSearchType!=="profiles",jobs=[];
    if(wantsProfiles)jobs.push(db.from("profiles").select("id,username,display_name,bio,avatar_url").or("username.ilike.%"+term+"%,display_name.ilike.%"+term+"%").limit(8));
    if(wantsCommunities)jobs.push(db.from("communities").select("id,name,slug,description,visibility,created_by").or("name.ilike.%"+term+"%,slug.ilike.%"+term+"%").limit(8));
    const results=await Promise.all(jobs);let index=0,profiles=[],communities=[],errors=[];
    if(wantsProfiles){const r=results[index++];if(r.error)errors.push(r.error.message);else profiles=r.data||[];}
    if(wantsCommunities){const r=results[index++];if(r.error)errors.push(r.error.message);else communities=r.data||[];}
    const memberIds=new Set(),requestMap=new Map();
    if(user&&communities.length){
      const [m,r]=await Promise.all([db.from("community_members").select("community_id").eq("user_id",user.id).in("community_id",communities.map(c=>c.id)),db.from("community_join_requests").select("community_id,status").eq("user_id",user.id).in("community_id",communities.map(c=>c.id))]);
      (m.data||[]).forEach(x=>memberIds.add(x.community_id));(r.data||[]).forEach(x=>requestMap.set(x.community_id,x.status));
    }
    const profileHtml=profiles.map(p=>'<button type="button" class="global-result profile-result" data-profile-view="'+p.id+'"><span class="global-result-avatar">'+(p.avatar_url?'<img src="'+esc(p.avatar_url)+'" alt="">':esc((p.display_name||p.username||"N").slice(0,1).toUpperCase()))+'</span><div class="global-result-copy"><strong>'+esc(p.display_name||p.username||"Üye")+'</strong><small>@'+esc(p.username||"uye")+'</small><p>'+esc(p.bio||"Henüz biyografi eklenmemiş.")+'</p></div><span class="profile-result-open">Profili gör ↗</span></button>').join("");
    const communityHtml=communities.map(c=>{
      let action=memberIds.has(c.id)?'<button class="btn btn-primary" data-search-open="'+c.id+'">Aç ↗</button>':c.visibility==="private"?(requestMap.has(c.id)?'<button class="btn btn-quiet" disabled>İstek '+(requestMap.get(c.id)==="pending"?"gönderildi":requestMap.get(c.id))+'</button>':'<button class="btn btn-quiet" data-search-request="'+c.id+'">Katılma isteği</button>'):'<button class="btn btn-quiet" data-search-join="'+c.id+'">Katıl +</button>';
      return '<article class="global-result community-result"><span class="global-result-symbol">◈</span><div class="global-result-copy"><strong>'+esc(c.name)+'</strong><small>'+(c.visibility==="private"?"🔒 Gizli topluluk":"● Herkese açık")+'</small><p>'+esc(c.description||"Topluluğu keşfet.")+'</p></div>'+action+'</article>';
    }).join("");
    box.innerHTML=(errors.length?'<p class="empty-note">'+esc(errors.join(" · "))+'</p>':"")+(wantsProfiles?'<div class="global-result-section">PROFİLLER</div>'+(profileHtml||'<p class="empty-note">Eşleşen profil yok.</p>'):"")+(wantsCommunities?'<div class="global-result-section">TOPLULUKLAR</div>'+(communityHtml||'<p class="empty-note">Eşleşen topluluk yok.</p>'):"");
    box.querySelectorAll("[data-search-open]").forEach(b=>b.addEventListener("click",()=>{$("global-search-dialog").close();openCommunity(communities.find(c=>c.id===b.dataset.searchOpen));}));
    box.querySelectorAll("[data-search-join]").forEach(b=>b.addEventListener("click",async()=>{if(!requireUser())return;const r=await db.from("community_members").insert({community_id:b.dataset.searchJoin,user_id:user.id,role:"member"});if(r.error&&!r.error.message.includes("duplicate"))return toast(r.error.message);toast("Topluluğa katıldın.");performGlobalSearch();}));
    box.querySelectorAll("[data-search-request]").forEach(b=>b.addEventListener("click",async()=>{if(!requireUser())return;const r=await db.from("community_join_requests").insert({community_id:b.dataset.searchRequest,user_id:user.id,status:"pending"});if(r.error)return toast(r.error.message);toast("Katılma isteğin gönderildi.");performGlobalSearch();}));
  }
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
        if (!result.data?.session) throw new Error("Oturum açılamadı. E-posta doğrulaman gerekiyorsa gelen kutunu kontrol et.");
        await syncAuthState();
        $("auth-dialog").close(); toast("Tekrar hoş geldin!");
      }
    } catch (err) { $("auth-message").textContent = err.message || "Bir hata oluştu."; }
    finally { button.disabled = false; }
  });
  $("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault(); if (!requireUser()) return;
    const {error} = await db.from("profiles").update({display_name:$("profile-display").value.trim(),bio:$("profile-bio").value.trim()}).eq("id",user.id);
    if (error) return toast(error.message);
    await loadProfile(); toast("Profilin kaydedildi.");
  });
  $("username-change-form").addEventListener("submit",async e=>{
    e.preventDefault();if(!requireUser())return;
    const next=$("new-username").value.trim().toLowerCase(),password=$("username-current-password").value,message=$("username-change-message");
    if(!/^[a-z0-9_]{3,24}$/.test(next)){message.textContent="3-24 karakter kullan; yalnızca harf, sayı ve _ olabilir.";return;}
    if(next===profile?.username){message.textContent="Bu zaten mevcut kullanıcı adın.";return;}
    if(!user.email){message.textContent="Hesap e-posta bilgisi alınamadı.";return;}
    const button=e.currentTarget.querySelector('button[type="submit"]');button.disabled=true;message.textContent="Şifren doğrulanıyor...";
    try{
      const auth=await db.auth.signInWithPassword({email:user.email,password});if(auth.error)throw new Error("Mevcut şifren doğru değil.");
      const changed=await db.rpc("change_username",{p_username:next});if(changed.error)throw changed.error;
      const refreshed=await db.from("profiles").select("id,username,display_name").eq("id",user.id).single();if(refreshed.error)throw refreshed.error;
      profile={...profile,username:refreshed.data.username};
      $("username-current-password").value="";message.textContent="Kullanıcı adın güncellendi.";toast("Kullanıcı adın değiştirildi.");await loadProfile();await loadSettings();
    }catch(err){message.textContent=err.message||"Kullanıcı adı değiştirilemedi.";}
    finally{button.disabled=false;}
  });
  $("community-form").addEventListener("submit", async (e) => {
    e.preventDefault(); if (!requireUser()) return;
    const name = $("community-name").value.trim();
    const slug = $("community-slug").value.trim().toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");
    if (slug.length < 3) return toast("Topluluk adresi en az 3 karakter olmalı.");
    const {data,error} = await db.from("communities").insert({name,slug,description:$("community-description").value.trim(),created_by:user.id,visibility:$("community-visibility").value}).select("id").single();
    if (error) return toast(error.message);
    const join = await db.from("community_members").insert({community_id:data.id,user_id:user.id,role:"owner"});
    if (join.error) return toast("Topluluk oluştu ancak üyelik kaydedilemedi: " + join.error.message);
    e.target.reset(); toast("Topluluğun oluşturuldu!"); await loadCommunities();
  });
  function updateMiniProfile(data){
    const name=data?.display_name||data?.username||"Profil",username="@"+(data?.username||"kullanıcı");
    ["sidebar-profile-name","room-profile-name"].forEach(id=>{if($(id))$(id).textContent=name;});
    ["sidebar-profile-username","room-profile-username"].forEach(id=>{if($(id))$(id).textContent=username;});
    ["sidebar-profile-avatar","room-profile-avatar"].forEach(id=>{const el=$(id);if(!el)return;el.innerHTML=data?.avatar_url?'<img src="'+esc(data.avatar_url)+'" alt="">':esc(name.slice(0,1).toUpperCase());});
  }
  async function loadProfile() {
    if (!user) { $("profile-display").value=""; $("profile-bio").value=""; return; }
    const {data,error} = await db.from("profiles").select("username,display_name,bio,avatar_url,username_changed_at").eq("id",user.id).maybeSingle();
    if (error) return toast(error.message);
    profile = data; if (!data) return;
    updateMiniProfile(data);
    $("profile-display").value = data.display_name || "";
    $("profile-bio").value = data.bio || "";
    $("profile-avatar").textContent = (data.display_name || data.username || "N").slice(0,1).toUpperCase();
    $("profile-avatar-image").classList.toggle("hidden",!data.avatar_url);
    $("profile-avatar").classList.toggle("hidden",!!data.avatar_url);
    if(data.avatar_url) $("profile-avatar-image").src=data.avatar_url;
  }
  async function loadHome(){await loadCommunities("home-community-list");}
  async function loadCommunities(targetId="community-list") {
    const listBox=$(targetId);if(!listBox)return;
    listBox.innerHTML = '<div class="loading">Topluluklar yükleniyor...</div>';
    const {data,error} = await db.from("communities").select("id,name,slug,description,created_at,created_by,visibility").order("created_at",{ascending:false}).limit(targetId==="home-community-list"?4:60);
    if (error) { listBox.innerHTML = '<div class="loading">'+esc(error.message)+'</div>'; return; }
    if(targetId==="community-list")$("community-count").textContent = (data||[]).length+" topluluk";
    if (!data?.length) { listBox.innerHTML = '<div class="card loading">Henüz topluluk yok. İlk topluluğu sen oluştur!</div>'; return; }
    let joined = new Set();
    let ownRequests=new Map();
    let pendingRequests=[];
    if(user){
      const [membersResult,ownResult,ownerResult]=await Promise.all([
        db.from("community_members").select("community_id").eq("user_id",user.id),
        db.from("community_join_requests").select("community_id,status").eq("user_id",user.id),
        db.from("community_join_requests").select("id,community_id,user_id,created_at,profiles!community_join_requests_user_id_fkey(username,display_name),communities!community_join_requests_community_id_fkey(name)").eq("status","pending").order("created_at",{ascending:true})
      ]);
      joined=new Set((membersResult.data||[]).map(m=>m.community_id));
      ownRequests=new Map((ownResult.data||[]).map(r=>[r.community_id,r.status]));
      pendingRequests=ownerResult.data||[];
    }
    listBox.innerHTML = data.map((c,i)=>{
      const isPrivate=c.visibility==="private";
      const action=joined.has(c.id)?`<button class="btn btn-primary" data-open-community="${c.id}">Topluluğu aç ↗</button>`:
        (isPrivate?(ownRequests.has(c.id)?`<button class="btn btn-quiet" disabled>${ownRequests.get(c.id)==="pending"?"İstek gönderildi":"İstek: "+(ownRequests.get(c.id)==="approved"?"onaylandı":"reddedildi")}</button>`:`<button class="btn btn-quiet" data-request="${c.id}">Katılma isteği gönder</button>`):`<button class="btn btn-quiet" data-join="${c.id}">Topluluğa katıl +</button>`);
      return `<article class="card community-card"><div class="community-symbol">${["✦","◈","⌘","✧"][i%4]}</div><div class="community-visibility">${isPrivate?"🔒 GİZLİ":"● HERKESE AÇIK"}</div><h3>${esc(c.name)}</h3><p>${esc(c.description||"Bu toplulukta yeni fikirler keşfet.")}</p><small>/c/${esc(c.slug)}</small><div class="community-card-actions">${action}</div></article>`;
    }).join("");
    listBox.querySelectorAll("[data-open-community]").forEach(btn=>btn.addEventListener("click",()=>openCommunity(data.find(c=>c.id===btn.dataset.openCommunity))));
    listBox.querySelectorAll("[data-join]").forEach(btn=>btn.addEventListener("click",async()=>{
      if(!requireUser())return; const {error:joinError}=await db.from("community_members").insert({community_id:btn.dataset.join,user_id:user.id,role:"member"});
      if(joinError && !joinError.message.includes("duplicate"))return toast(joinError.message);
      toast("Topluluğa katıldın!"); loadCommunities(targetId);
    }));
    listBox.querySelectorAll("[data-request]").forEach(btn=>btn.addEventListener("click",async()=>{
      if(!requireUser())return;
      const {error:requestError}=await db.from("community_join_requests").insert({community_id:btn.dataset.request,user_id:user.id,status:"pending"});
      if(requestError)return toast(requestError.message);
      toast("Katılma isteğin gönderildi.");loadCommunities(targetId);
    }));
    if(targetId==="home-community-list")return;
    const requestBox=$("community-requests");
    requestBox.classList.toggle("hidden",!pendingRequests.length);
    $("community-request-list").innerHTML=pendingRequests.map(r=>`<div class="community-request-row"><div><strong>${esc(r.profiles?.display_name||r.profiles?.username||"Üye")}</strong><small>@${esc(r.profiles?.username||"üye")} · ${esc(r.communities?.name||"Topluluk")}</small></div><div><button class="btn btn-primary" data-approve-request="${r.id}">Onayla</button> <button class="btn btn-quiet" data-reject-request="${r.id}">Reddet</button></div></div>`).join("");
    $("community-request-list").querySelectorAll("[data-approve-request]").forEach(btn=>btn.addEventListener("click",async()=>{
      const request=pendingRequests.find(r=>r.id===btn.dataset.approveRequest);if(!request)return;
      const joinedResult=await db.from("community_members").insert({community_id:request.community_id,user_id:request.user_id,role:"member"});
      if(joinedResult.error&&!joinedResult.error.message.includes("duplicate"))return toast(joinedResult.error.message);
      const updated=await db.from("community_join_requests").update({status:"approved",reviewed_at:new Date().toISOString()}).eq("id",request.id);
      if(updated.error)return toast(updated.error.message);
      toast("Katılma isteği onaylandı.");loadCommunities();
    }));
    $("community-request-list").querySelectorAll("[data-reject-request]").forEach(btn=>btn.addEventListener("click",async()=>{
      const updated=await db.from("community_join_requests").update({status:"rejected",reviewed_at:new Date().toISOString()}).eq("id",btn.dataset.rejectRequest);
      if(updated.error)return toast(updated.error.message);toast("İstek reddedildi.");loadCommunities();
    }));
  }
  async function findProfiles(ids){const clean=[...new Set(ids.filter(Boolean))];if(!clean.length)return [];const {data,error}=await db.from("profiles").select("id,username,display_name,avatar_url").in("id",clean);if(error)throw error;return data||[];}
  async function loadFriends(){
    if(!user)return;const results=await Promise.all([db.from("friend_requests").select("id,sender_id").eq("receiver_id",user.id).eq("status","pending"),db.from("friend_requests").select("id,receiver_id").eq("sender_id",user.id).eq("status","pending"),db.from("friendships").select("user_a,user_b").or("user_a.eq."+user.id+",user_b.eq."+user.id)]);
    const [incoming,outgoing,links]=results;if(results.some(r=>r.error)){toast(results.find(r=>r.error).error.message);return;}
    const ids=[...(incoming.data||[]).map(r=>r.sender_id),...(outgoing.data||[]).map(r=>r.receiver_id),...(links.data||[]).map(r=>r.user_a===user.id?r.user_b:r.user_a)],people=await findProfiles(ids),byId=new Map(people.map(p=>[p.id,p]));
    const render=p=>'<strong>'+esc(p?.display_name||p?.username||"Üye")+'</strong><small>@'+esc(p?.username||"uye")+'</small>';
    $("friend-incoming").innerHTML=incoming.data?.length?incoming.data.map(r=>'<div class="friend-row"><div class="friend-person">'+render(byId.get(r.sender_id))+'</div><div class="friend-actions"><button class="btn btn-primary" data-accept="'+r.id+'">Kabul et</button><button class="btn btn-quiet" data-reject="'+r.id+'">Reddet</button></div></div>').join(""):'<p class="empty-note">Bekleyen istek yok.</p>';
    $("friend-outgoing").innerHTML=outgoing.data?.length?outgoing.data.map(r=>'<div class="friend-row"><div class="friend-person">'+render(byId.get(r.receiver_id))+'</div><span class="request-pending">İstek gönderildi</span></div>').join(""):'<p class="empty-note">Gönderdiğin istek yok.</p>';
    $("friend-list").innerHTML=links.data?.length?links.data.map(r=>{const id=r.user_a===user.id?r.user_b:r.user_a;return '<div class="friend-row"><div class="friend-person">'+render(byId.get(id))+'</div><button class="btn btn-primary" data-open-dm="'+id+'">Mesaj gönder</button></div>';}).join(""):'<p class="empty-note">Henüz arkadaşın yok. Yukarıdan kullanıcı ara.</p>';
    $("friend-incoming").querySelectorAll("[data-accept]").forEach(b=>b.addEventListener("click",async()=>{const r=await db.rpc("accept_friend_request",{p_request_id:b.dataset.accept});if(r.error)return toast(r.error.message);toast("Arkadaşlık isteği kabul edildi.");loadFriends();}));
    $("friend-incoming").querySelectorAll("[data-reject]").forEach(b=>b.addEventListener("click",async()=>{const r=await db.from("friend_requests").update({status:"rejected"}).eq("id",b.dataset.reject);if(r.error)return toast(r.error.message);loadFriends();}));
    $("friend-list").querySelectorAll("[data-open-dm]").forEach(b=>b.addEventListener("click",async()=>{const p=byId.get(b.dataset.openDm);if(p){setView("messages");await openDm(p);}}));
  }
  async function searchFriends(){
    if(!requireUser())return;const term=$("friend-search").value.trim().replace(/^@/,"").replace(/[%_,()]/g," ").replace(/\s+/g," ").toLowerCase().trim();if(term.length<2){$("friend-search-results").textContent="En az 2 karakter yaz.";return;}
    const {data,error}=await db.from("profiles").select("id,username,display_name,bio,avatar_url").or("username.ilike.%"+term+"%,display_name.ilike.%"+term+"%").neq("id",user.id).limit(12);if(error){$("friend-search-results").textContent=error.message;return;}if(!data?.length){$("friend-search-results").textContent="Kullanıcı bulunamadı.";return;}
    const [l,r]=await Promise.all([db.from("friendships").select("user_a,user_b").or("user_a.eq."+user.id+",user_b.eq."+user.id),db.from("friend_requests").select("sender_id,receiver_id").eq("status","pending").or("sender_id.eq."+user.id+",receiver_id.eq."+user.id)]);
    const friends=new Set((l.data||[]).map(x=>x.user_a===user.id?x.user_b:x.user_a)),pending=new Set((r.data||[]).map(x=>x.sender_id===user.id?x.receiver_id:x.sender_id));
    $("friend-search-results").innerHTML=data.map(p=>'<div class="friend-row friend-search-row"><button type="button" class="friend-person friend-profile-trigger" data-profile-view="'+p.id+'"><span class="friend-avatar">'+(p.avatar_url?'<img src="'+esc(p.avatar_url)+'" alt="">':esc((p.display_name||p.username||"N").slice(0,1).toUpperCase()))+'</span><span><strong>'+esc(p.display_name||p.username)+'</strong><small>@'+esc(p.username)+'</small><small>'+esc(p.bio||"")+'</small></span></button>'+(friends.has(p.id)?'<span class="request-pending">Arkadaşsınız</span>':pending.has(p.id)?'<span class="request-pending">İstek bekliyor</span>':'<button class="btn btn-quiet" data-add="'+p.id+'">Arkadaş ekle +</button>')+'</div>').join("");
    $("friend-search-results").querySelectorAll("[data-add]").forEach(b=>b.addEventListener("click",async()=>{const x=await db.from("friend_requests").insert({sender_id:user.id,receiver_id:b.dataset.add});if(x.error)return toast(x.error.message);toast("Arkadaşlık isteği gönderildi.");loadFriends();searchFriends();}));
  }
  async function loadMessages(){
    if(!user)return;const {data:links,error}=await db.from("friendships").select("user_a,user_b").or("user_a.eq."+user.id+",user_b.eq."+user.id);if(error){$("dm-conversations").textContent=error.message;return;}
    const ids=(links||[]).map(r=>r.user_a===user.id?r.user_b:r.user_a),people=await findProfiles(ids);
    $("dm-conversations").innerHTML=people.length?people.map(p=>'<button class="dm-contact" data-dm="'+p.id+'"><strong>'+esc(p.display_name||p.username)+'</strong><small>@'+esc(p.username)+'</small></button>').join(""):'<div class="empty-note">Mesajlaşmak için önce arkadaş ekle.</div>';
    $("dm-conversations").querySelectorAll("[data-dm]").forEach(b=>b.addEventListener("click",()=>openDm(people.find(p=>p.id===b.dataset.dm))));
    if(activeDm&&ids.includes(activeDm.id))await loadDmMessages();
    if(!dmChannel)dmChannel=db.channel("nexora-dm-"+user.id).on("postgres_changes",{event:"INSERT",schema:"public",table:"direct_messages"},payload=>{const m=payload.new;if(activeDm&&[m.sender_id,m.receiver_id].includes(activeDm.id))loadDmMessages();}).subscribe();
  }
  async function openDm(person){if(!person)return;activeDm=person;$("dm-thread-head").innerHTML='<strong>'+esc(person.display_name||person.username)+'</strong><small>@'+esc(person.username)+'</small>';$("dm-input").disabled=false;$("dm-send").disabled=false;$("dm-conversations").querySelectorAll(".dm-contact").forEach(b=>b.classList.toggle("active",b.dataset.dm===person.id));await loadDmMessages();}
  async function loadDmMessages(){
    if(!activeDm||!user)return;const {data,error}=await db.from("direct_messages").select("id,sender_id,content,created_at").or("and(sender_id.eq."+user.id+",receiver_id.eq."+activeDm.id+"),and(sender_id.eq."+activeDm.id+",receiver_id.eq."+user.id+")").order("created_at",{ascending:true}).limit(200);
    if(error){$("dm-thread-messages").textContent=error.message;return;}
    $("dm-thread-messages").innerHTML=data?.length?data.map(m=>'<div class="dm-bubble '+(m.sender_id===user.id?'mine':'')+'"><p>'+esc(m.content)+'</p><small>'+esc(when(m.created_at))+'</small></div>').join(""):'<div class="room-empty">Henüz mesaj yok. İlk mesajı gönder!</div>';$("dm-thread-messages").scrollTop=$("dm-thread-messages").scrollHeight;
  }
  $("friend-search-btn").addEventListener("click",searchFriends);
  $("friend-search").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();searchFriends();}});
  $("dm-form").addEventListener("submit",async e=>{e.preventDefault();if(!activeDm||!requireUser())return;const content=$("dm-input").value.trim();if(!content)return;$("dm-send").disabled=true;const r=await db.from("direct_messages").insert({sender_id:user.id,receiver_id:activeDm.id,content});$("dm-send").disabled=false;if(r.error)return toast(r.error.message);$("dm-input").value="";await loadDmMessages();});
  async function loadSettings(){
    if(!user)return;
    const {data,error}=await db.auth.mfa.listFactors();
    if(error){$("mfa-status").textContent="2FA durumu alınamadı: "+error.message;return;}
    const verified=(data?.totp||[]).filter(f=>f.status==="verified");
    const unfinished=(data?.totp||[]).filter(f=>f.status==="unverified");
    for(const factor of unfinished){await db.auth.mfa.unenroll({factorId:factor.id});}
    $("mfa-status").textContent=verified.length?"● İki faktörlü doğrulama etkin":"○ İki faktörlü doğrulama kapalı";
    $("mfa-start").classList.toggle("hidden",verified.length>0);
    $("mfa-disable").classList.toggle("hidden",verified.length===0);
    const p=await db.from("profiles").select("username,username_changed_at").eq("id",user.id).single();
    if(!p.error){
      $("new-username").value=p.data.username||"";
      const button=$("username-change-form").querySelector('button[type="submit"]');
      if(p.data.username_changed_at){
        const next=new Date(new Date(p.data.username_changed_at).getTime()+7*86400000);
        if(next>Date.now()){$("username-change-limit").textContent="Sonraki değişiklik: "+next.toLocaleString("tr-TR",{dateStyle:"medium",timeStyle:"short"});button.disabled=true;}
        else{$("username-change-limit").textContent="Kullanıcı adını şimdi değiştirebilirsin.";button.disabled=false;}
      }else{$("username-change-limit").textContent="Henüz kullanıcı adı değişikliği yapmadın.";button.disabled=false;}
    }
  }
  async function updateAuth(session) {
    const revision = ++authRevision;
    user = session?.user || null;
    if(user){
      const aal=await db.auth.mfa.getAuthenticatorAssuranceLevel();
      if(revision!==authRevision)return;
      if(aal.data?.nextLevel==="aal2"&&aal.data?.currentLevel!=="aal2"){
        $("welcome-screen").classList.add("hidden");document.querySelector(".layout").classList.add("hidden");
        $("auth-open").classList.add("hidden");
        if(!mfaLoginActive){
          mfaLoginActive=true;
          const factors=await db.auth.mfa.listFactors();
          if(revision!==authRevision)return;
          const factor=(factors.data?.totp||[]).find(f=>f.status==="verified");
          if(!factor){$("mfa-login-message").textContent="Doğrulanmış authenticator bulunamadı. Destek için platform yöneticisine başvur.";return;}
          const challenge=await db.auth.mfa.challenge({factorId:factor.id});
          if(revision!==authRevision)return;
          if(challenge.error){$("mfa-login-message").textContent=challenge.error.message;return;}
          $("mfa-login-form").dataset.factorId=factor.id;$("mfa-login-form").dataset.challengeId=challenge.data.id;
          $("mfa-login-message").textContent="";$("mfa-login-dialog").showModal();
        }
        return;
      }
    }
    mfaLoginActive=false;
    if($("mfa-login-dialog").open)$("mfa-login-dialog").close();
    $("welcome-screen").classList.toggle("hidden",!!user);
    document.querySelector(".layout").classList.toggle("hidden",!user);
    $("auth-open").classList.add("hidden");
    if (user) {
      const {data,error:profileError} = await db.from("profiles").select("id,username,display_name,bio,avatar_url").eq("id",user.id).maybeSingle();
      if (revision !== authRevision) return;
      if (profileError) console.error("NEXORA profile lookup:",profileError);
      profile = data; updateMiniProfile(data||{username:user.email?.split("@")[0]||"üye"});
      $("admin-nav").classList.toggle("hidden",user.id!==FOUNDER_UID);
    } else { profile=null; updateMiniProfile(null); $("admin-nav").classList.add("hidden"); }
    if (revision !== authRevision) return;
    await Promise.all([loadHome(),loadCommunities()]);
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
    const {data:member,error:memberError}=await db.from("community_members").select("community_id,role").eq("community_id",community.id).eq("user_id",user.id).maybeSingle();
    if(memberError||!member) return toast("Bu topluluğun üyesi olmalısın.");
    activeCommunity=community; communityRole=member.role||"member";
    $("room-title").textContent=community.name;
    $("room-description").textContent=community.description||"Topluluğun kanalları ve üyeleri.";
    setView("community-room");
    await loadCommunityStructure();
    await subscribeToActiveRoom();
  }
  async function manageCommunityMember(targetId,targetRole){
    const choice=prompt("Üye işlemi: 1=Rol ata, 2=Sustur, 3=Yasakla, 4=Üyeyi çıkar, 5=Susturmayı kaldır");
    if(!choice)return;
    if(choice==="1"){
      const role=prompt("Yeni rol: member / moderator / admin","member");if(!role)return;
      if(!["member","moderator","admin"].includes(role))return toast("Geçersiz rol.");
      const customName=prompt("Görünen rol adı (isteğe bağlı):","")||"";
      const color=prompt("Rol rengi HEX (örn. #B58AFF), isteğe bağlı:","")||"";
      const r=await db.rpc("community_assign_role",{p_community_id:activeCommunity.id,p_target_user_id:targetId,p_role:role,p_role_name:customName||null,p_role_color:color||null});
      if(r.error)return toast(r.error.message);toast("Üye rolü güncellendi.");await loadCommunityStructure(activeChannel?.id,activeRoom?.id);
    }else if(choice==="2"||choice==="3"){
      const mins=Number(prompt("Süre dakika olarak (1-43200):",choice==="2"?"60":"1440"));
      if(!Number.isInteger(mins)||mins<1||mins>43200)return toast("Süre 1-43200 dakika olmalı.");
      const reason=prompt("Sebep (isteğe bağlı):","")||"";
      const r=await db.rpc("community_moderate_member",{p_community_id:activeCommunity.id,p_target_user_id:targetId,p_action:choice==="2"?"mute":"ban",p_duration_minutes:mins,p_reason:reason});
      if(r.error)return toast(r.error.message);toast(choice==="2"?"Üye susturuldu.":"Üye topluluktan yasaklandı.");await loadCommunityStructure(activeChannel?.id,activeRoom?.id);
    }else if(choice==="5"){
      const r=await db.rpc("community_moderate_member",{p_community_id:activeCommunity.id,p_target_user_id:targetId,p_action:"unmute",p_duration_minutes:null,p_reason:""});
      if(r.error)return toast(r.error.message);toast("Üyenin susturması kaldırıldı.");await loadCommunityStructure(activeChannel?.id,activeRoom?.id);
    }else if(choice==="4"){
      if(!confirm("Bu üyeyi topluluktan çıkarmak istiyor musun?"))return;
      const r=await db.from("community_members").delete().eq("community_id",activeCommunity.id).eq("user_id",targetId);
      if(r.error)return toast(r.error.message);toast("Üye topluluktan çıkarıldı.");await loadCommunityStructure(activeChannel?.id,activeRoom?.id);
    }
  }
  async function openCommunitySettings(){
    if(!activeCommunity)return;
    const [settings,community]=await Promise.all([
      db.from("community_settings").select("*").eq("community_id",activeCommunity.id).maybeSingle(),
      db.from("communities").select("name,description,visibility").eq("id",activeCommunity.id).single()
    ]);
    if(settings.error||community.error)return toast((settings.error||community.error).message);
    $("community-setting-name").value=community.data.name||"";
    const canEditDetails=activeCommunity.created_by===user.id;
    $("community-setting-name").disabled=!canEditDetails;$("community-setting-description").disabled=!canEditDetails;$("community-setting-visibility").disabled=!canEditDetails;
    $("community-settings-form").querySelector('button[type="submit"]').classList.toggle("hidden",!(communityRole==="owner"||communityRole==="admin"));
    $("community-setting-description").value=community.data.description||"";
    $("community-setting-visibility").value=community.data.visibility||"public";
    $("community-profanity-filter").checked=settings.data?.profanity_filter??true;
    $("community-blocked-words").value=(settings.data?.blocked_words||[]).join(", ");
    $("community-slow-mode").value=String(settings.data?.slow_mode_seconds||0);
    $("community-media-enabled").checked=settings.data?.media_enabled??true;
    $("community-settings-dialog").showModal();
  }
  $("community-settings-open").addEventListener("click",openCommunitySettings);
  $("community-settings-close").addEventListener("click",()=>$("community-settings-dialog").close());
  $("community-settings-form").addEventListener("submit",async e=>{
    e.preventDefault();if(!activeCommunity)return;
    const settings=await db.rpc("community_update_settings",{p_community_id:activeCommunity.id,p_profanity_filter:$("community-profanity-filter").checked,p_blocked_words:$("community-blocked-words").value.split(",").map(x=>x.trim()).filter(Boolean),p_slow_mode_seconds:Number($("community-slow-mode").value),p_media_enabled:$("community-media-enabled").checked});
    if(settings.error)return toast(settings.error.message);
    if(activeCommunity.created_by===user.id){
      const updated=await db.from("communities").update({name:$("community-setting-name").value.trim(),description:$("community-setting-description").value.trim(),visibility:$("community-setting-visibility").value}).eq("id",activeCommunity.id);
      if(updated.error)return toast(updated.error.message);
      activeCommunity={...activeCommunity,name:$("community-setting-name").value.trim(),description:$("community-setting-description").value.trim(),visibility:$("community-setting-visibility").value};
      $("room-title").textContent=activeCommunity.name;$("room-description").textContent=activeCommunity.description;
    }
    $("community-settings-dialog").close();toast("Topluluk ayarları kaydedildi.");
  });
  $("community-clear-chat").addEventListener("click",async()=>{
    if(!activeCommunity||!confirm("Bu topluluğun tüm sohbet mesajları kalıcı olarak silinsin mi?"))return;
    const r=await db.from("community_messages").delete().eq("community_id",activeCommunity.id);
    if(r.error)return toast(r.error.message);toast("Topluluk sohbeti temizlendi.");await loadRoomMessages();
  });
  async function loadCommunityStructure(preferredChannelId=null, preferredRoomId=null) {
    if(!activeCommunity)return;
    const [channelsResult,membersResult]=await Promise.all([
      db.from("community_channels").select("id,community_id,name,created_by,sort_order,created_at").eq("community_id",activeCommunity.id).order("sort_order").order("created_at"),
      db.from("community_members").select("user_id,role,role_name,role_color,muted_until,joined_at,profiles!community_members_user_id_fkey(username,display_name,avatar_url)").eq("community_id",activeCommunity.id).order("joined_at")
    ]);
    communityChannelError=channelsResult.error?.message||null;
    if(channelsResult.error){$("room-channel-list").innerHTML='<p class="empty-note">Kanallar alınamadı: '+esc(channelsResult.error.message)+'</p>';communityChannels=[];}else communityChannels=channelsResult.data||[];
    if(membersResult.error){$("room-member-list").innerHTML='<p class="empty-note">Üyeler alınamadı: '+esc(membersResult.error.message)+'</p>';$("room-member-count").textContent="—";communityMembers=[];}else communityMembers=membersResult.data||[];
    const ids=communityChannels.map(c=>c.id);
    const roomsResult=ids.length?await db.from("community_rooms").select("id,community_id,channel_id,name,topic,created_by,sort_order,created_at").in("channel_id",ids).order("sort_order").order("created_at"):{data:[],error:null};
    if(roomsResult.error){communityChannelError="Odalar alınamadı: "+roomsResult.error.message;$("room-channel-list").innerHTML='<p class="empty-note">'+esc(communityChannelError)+'</p>';communityRooms=[];}else communityRooms=roomsResult.data||[];
    const canManage=communityRole==="owner"||communityRole==="admin"||communityRole==="moderator"||activeCommunity.created_by===user?.id;
    $("community-settings-open").classList.toggle("hidden",!(communityRole==="owner"||communityRole==="admin"||communityRole==="moderator"||activeCommunity.created_by===user?.id));
    $("channel-create-toggle").classList.toggle("hidden",!canManage);
    $("room-create-toggle").classList.toggle("hidden",!canManage);
    $("room-member-count").textContent=String(communityMembers.length);
    if(!membersResult.error)$("room-member-list").innerHTML=communityMembers.length?communityMembers.map(m=>{
      const p=m.profiles||{},isCommunityFounder=m.user_id===activeCommunity.created_by,isPlatformFounder=m.user_id===FOUNDER_UID;
      const label=isCommunityFounder?"KURUCU":isPlatformFounder?"NEXORA KURUCU":m.role_name||({admin:"YÖNETİCİ",moderator:"MODERATÖR",member:"ÜYE"}[m.role]||"ÜYE");
      const canAct=!isCommunityFounder&&m.user_id!==user?.id&&(communityRole==="owner"||communityRole==="admin"||(communityRole==="moderator"&&m.role==="member"));
      return '<div class="room-member"><button type="button" class="room-member-profile" data-profile-view="'+m.user_id+'"><span class="room-member-avatar">'+(p.avatar_url?'<img src="'+esc(p.avatar_url)+'" alt="">':esc((p.display_name||p.username||"N").slice(0,1).toUpperCase()))+'</span><span class="room-member-name"><strong class="'+(isPlatformFounder?'founder-name':'')+'">'+esc(p.display_name||p.username||"Üye")+'</strong><small>@'+esc(p.username||"uye")+'</small></span></button><span class="room-member-role '+(isCommunityFounder||isPlatformFounder?'founder-name':'')+'" '+(m.role_color?'style="color:'+esc(m.role_color)+'"':'')+'>'+esc(label)+'</span>'+(canAct?'<button class="room-member-manage" type="button" data-manage-member="'+m.user_id+'" data-member-role="'+esc(m.role)+'">•••</button>':'')+'</div>';
    }).join(""):'<p class="empty-note">Henüz üye yok.</p>';
    $("room-member-list").querySelectorAll("[data-manage-member]").forEach(btn=>btn.addEventListener("click",()=>manageCommunityMember(btn.dataset.manageMember,btn.dataset.memberRole)));
    const desiredChannel=communityChannels.find(c=>c.id===preferredChannelId)||communityChannels.find(c=>c.id===activeChannel?.id)||communityChannels[0]||null;
    activeChannel=desiredChannel;
    const desiredRooms=communityRooms.filter(r=>r.channel_id===activeChannel?.id);
    activeRoom=desiredRooms.find(r=>r.id===preferredRoomId)||desiredRooms.find(r=>r.id===activeRoom?.id)||desiredRooms[0]||null;
    $("room-create-channel").innerHTML=communityChannels.map(c=>'<option value="'+c.id+'" '+(c.id===activeChannel?.id?'selected':'')+'>'+esc(c.name)+'</option>').join("");
    renderCommunityChannels();
    updateActiveRoomHeading();
    await loadRoomMessages();
  }
  function renderCommunityChannels(){
    const canManage=communityRole==="owner"||communityRole==="admin"||communityRole==="moderator"||activeCommunity?.created_by===user?.id;
    if(communityChannelError){$("room-channel-list").innerHTML='<p class="empty-note">'+esc(communityChannelError)+'</p>';return;}
    $("room-channel-list").innerHTML=communityChannels.map(channel=>{
      const rooms=communityRooms.filter(r=>r.channel_id===channel.id);
      return '<div class="room-channel-group"><div class="room-channel-heading"><strong>'+esc(channel.name)+'</strong>'+(canManage?'<button class="room-add-inline" type="button" data-add-room="'+channel.id+'" title="Bu kanala oda ekle">+</button>':'')+'</div>'+rooms.map(room=>'<button type="button" class="room-link '+(activeRoom?.id===room.id?'active':'')+'" data-room-id="'+room.id+'"><span>#</span>'+esc(room.name)+'</button>').join("")+'</div>';
    }).join("")||'<p class="empty-note">Henüz kanal yok.</p>';
    $("room-channel-list").querySelectorAll("[data-room-id]").forEach(btn=>btn.addEventListener("click",async()=>{
      const selected=communityRooms.find(r=>r.id===btn.dataset.roomId);if(!selected)return;
      activeChannel=communityChannels.find(c=>c.id===selected.channel_id)||null;activeRoom=selected;
      $("room-create-channel").value=selected.channel_id;
      renderCommunityChannels();updateActiveRoomHeading();await loadRoomMessages();await subscribeToActiveRoom();
    }));
    $("room-channel-list").querySelectorAll("[data-add-room]").forEach(btn=>btn.addEventListener("click",()=>{
      $("room-create-channel").value=btn.dataset.addRoom;$("room-create-form").classList.remove("hidden");$("room-name").focus();
    }));
  }
  function updateActiveRoomHeading(){
    $("room-channel-name").textContent=activeChannel?.name||"Kanallar";
    $("active-room-title").textContent=activeRoom?"# "+activeRoom.name:"Oda seçilmedi";
    $("active-room-topic").textContent=activeRoom?.topic||"Bu odada topluluk üyeleriyle paylaşım yap.";
    $("room-form").classList.toggle("hidden",!activeRoom);
    $("room-messages").innerHTML=activeRoom?'<div class="loading">Mesajlar yükleniyor...</div>':'<div class="room-empty">Mesajlaşmak için bir oda oluşturulmasını veya seçilmesini bekle.</div>';
  }
  async function subscribeToActiveRoom(){
    if(roomChannel){await db.removeChannel(roomChannel);roomChannel=null;}
    if(!activeRoom)return;
    roomChannel=db.channel("community-room-"+activeRoom.id).on("postgres_changes",{event:"*",schema:"public",table:"community_messages",filter:"room_id=eq."+activeRoom.id},()=>loadRoomMessages()).subscribe();
  }
  async function loadRoomMessages() {
    if(!activeRoom)return;
    const box=$("room-messages");box.innerHTML='<div class="loading">Mesajlar yükleniyor...</div>';
    const {data,error}=await db.from("community_messages").select("id,author_id,message_type,content,media_path,created_at,profiles!community_messages_author_id_fkey(username,display_name,avatar_url)").eq("room_id",activeRoom.id).order("created_at",{ascending:true}).limit(150);
    if(error){box.innerHTML='<div class="loading">'+esc(error.message)+'</div>';return;}
    if(!data?.length){box.innerHTML='<div class="room-empty">Bu odada henüz mesaj yok. İlk mesajı sen gönder!</div>';return;}
    const rendered=await Promise.all(data.map(async m=>{
      let media="";
      if(m.media_path){const signed=await db.storage.from("community-media").createSignedUrl(m.media_path,3600);if(!signed.error&&signed.data?.signedUrl){media=m.message_type==="image"?'<img class="room-image" src="'+esc(signed.data.signedUrl)+'" alt="Paylaşılan fotoğraf" loading="lazy">':'<audio class="room-audio" controls preload="none" src="'+esc(signed.data.signedUrl)+'"></audio>';}}
      const p=m.profiles||{},founder=m.author_id===FOUNDER_UID;
      const undoable=m.author_id===user?.id&&Date.now()-new Date(m.created_at).getTime()<=15*60*1000;
      return '<article class="room-message">'+(p.avatar_url?'<img class="room-avatar" src="'+esc(p.avatar_url)+'" alt="">':'<div class="room-avatar">'+esc((p.display_name||p.username||"N").slice(0,1).toUpperCase())+'</div>')+'<div class="room-message-body"><div class="room-message-head"><strong class="'+(founder?'founder-name':'')+'">'+esc(p.display_name||p.username||"Üye")+'</strong> '+(founder?'<span class="founder-badge">♛ KURUCU</span>':'')+' <small>@'+esc(p.username||"uye")+' · '+esc(when(m.created_at))+'</small></div>'+(m.content?'<p>'+esc(m.content)+'</p>':'')+media+(undoable?'<div class="room-message-actions"><button type="button" data-undo-message="'+m.id+'">↶ Geri al</button><small>15 dk içinde</small></div>':'')+'</div></article>';
    }));
    box.innerHTML=rendered.join("");box.scrollTop=box.scrollHeight;
    box.querySelectorAll("[data-undo-message]").forEach(btn=>btn.addEventListener("click",async()=>{
      if(!confirm("Bu mesajı geri almak istiyor musun?"))return;
      const removed=await db.from("community_messages").delete().eq("id",btn.dataset.undoMessage).eq("author_id",user.id);
      if(removed.error)return toast("Mesaj geri alınamadı: "+removed.error.message);
      toast("Mesaj geri alındı.");await loadRoomMessages();
    }));
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
    const {error}=await db.from("community_messages").insert({community_id:activeCommunity.id,room_id:activeRoom?.id,author_id:user.id,message_type,content,media_path});
    if(error)return toast(error.message);
    $("room-message").value="";$("room-file").value="";$("room-file-name").textContent="";if(fileOverride)toast("Sesli mesaj gönderildi.");await loadRoomMessages();
  }

  $("channel-create-toggle").addEventListener("click",()=>{$("channel-create-form").classList.toggle("hidden");if(!$("channel-create-form").classList.contains("hidden"))$("channel-name").focus();});
  $("room-create-toggle").addEventListener("click",()=>{$("room-create-form").classList.toggle("hidden");$("room-create-channel").value=activeChannel?.id||"";if(!$("room-create-form").classList.contains("hidden"))$("room-name").focus();});
  $("channel-create-form").addEventListener("submit",async e=>{
    e.preventDefault();if(!requireUser()||!activeCommunity)return;
    const name=$("channel-name").value.trim();if(name.length<2)return toast("Kanal adı en az 2 karakter olmalı.");
    const {data,error}=await db.from("community_channels").insert({community_id:activeCommunity.id,name,created_by:user.id,sort_order:communityChannels.length}).select("id").single();
    if(error)return toast(error.message);
    $("channel-name").value="";$("channel-create-form").classList.add("hidden");await loadCommunityStructure(data.id);toast("Kanal oluşturuldu.");
  });
  $("room-create-form").addEventListener("submit",async e=>{
    e.preventDefault();if(!requireUser()||!activeCommunity)return;
    const name=$("room-name").value.trim(),channelId=$("room-create-channel").value,topic=$("room-topic").value.trim();
    if(!channelId)return toast("Önce bir kanal oluştur.");
    if(name.length<2)return toast("Oda adı en az 2 karakter olmalı.");
    const {data,error}=await db.from("community_rooms").insert({community_id:activeCommunity.id,channel_id:channelId,name,topic,created_by:user.id,sort_order:communityRooms.filter(r=>r.channel_id===channelId).length}).select("id").single();
    if(error)return toast(error.message);
    $("room-name").value="";$("room-topic").value="";$("room-create-form").classList.add("hidden");await loadCommunityStructure(channelId,data.id);await subscribeToActiveRoom();toast("Oda oluşturuldu.");
  });
  $("room-form").addEventListener("submit",async e=>{e.preventDefault();await sendRoomMessage();});
  $("room-file").addEventListener("change",e=>{const file=e.target.files?.[0];$("room-file-name").textContent=file?file.name:"";if(file)toast("Dosya eklendi. Uçak simgesine basarak gönder.");});
  $("record-audio").addEventListener("click",async()=>{
    if(!requireUser())return;
    if(mediaRecorder?.state==="recording"){mediaRecorder.stop();$("record-audio").textContent="🎙";$("record-status").textContent="Ses hazırlanıyor...";return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return toast("Bu tarayıcı ses kaydını desteklemiyor.");
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      mediaRecorder=new MediaRecorder(stream);recordingChunks=[];
      mediaRecorder.ondataavailable=e=>{if(e.data.size)recordingChunks.push(e.data);};
      mediaRecorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(recordingChunks,{type:mediaRecorder.mimeType||"audio/webm"});const ext=blob.type.includes("ogg")?"ogg":blob.type.includes("mp4")?"m4a":"webm";const voice=new File([blob],"voice-note-"+Date.now()+"."+ext,{type:blob.type});$("record-status").textContent="";await sendRoomMessage(voice);};
      mediaRecorder.start();$("record-audio").textContent="■";$("record-status").textContent="Ses kaydediliyor...";
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
  // Auth olaylarını callback dışına taşı ve her seferinde depodaki en güncel oturumu oku.
  // Böylece ilk yükleme, SIGNED_IN ve token yenileme olayları eski session ile birbirini ezmez.
  async function syncAuthState() {
    const {data,error}=await db.auth.getSession();
    if(error)throw error;
    setConnection(true,"Supabase bağlı");
    await updateAuth(data.session);
  }
  let authSyncTimer=null;
  db.auth.onAuthStateChange((_event)=>{
    if(authSyncTimer!==null)window.clearTimeout(authSyncTimer);
    authSyncTimer=window.setTimeout(()=>{
      authSyncTimer=null;
      syncAuthState().catch(err=>{
        console.error("NEXORA auth state sync:",err);
        setConnection(false,"Oturum yenilenemedi");
        toast("Oturum güncellenemedi. Tekrar giriş yapmayı dene.");
      });
    },0);
  });
  (async()=>{
    try {
      await syncAuthState();
    } catch(err) {
      setConnection(false,"Bağlantı hatası");
      $("home-community-list").innerHTML='<div class="loading">'+esc(err.message)+'</div>';
      console.error("NEXORA session bootstrap:",err);
    }
  })();
})();