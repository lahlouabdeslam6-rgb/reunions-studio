(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const host = document.body.classList.contains('host');
  const peers = new Map();
  let session, local, mixer, mixOutput, recorder, stoppingCapture, timer;
  let cameraTrack, ownVideo;
  let generation = 0, chunks = [], recordedBytes = 0;
  let roomParticipants = [];

  function status(message,error=false) {
    $('status').textContent = message;
    $('status').classList.toggle('error',error);
  }
  async function request(route,input,credentials=session) {
    const headers = {};
    if (input !== undefined) headers['Content-Type'] = 'application/json';
    if (credentials) {
      headers['X-Room-Peer'] = credentials.id;
      headers['X-Room-Token'] = credentials.token;
    }
    const res = await fetch(route,{method:input === undefined ? 'GET' : 'POST',headers,
      body:input === undefined ? undefined : JSON.stringify(input),cache:'no-store',signal:AbortSignal.timeout(7000)});
    const value = await res.json();
    if (!res.ok) throw Object.assign(new Error(value.error),{status:res.status});
    return value;
  }
  const endpoint = operation => `/api/rooms/${session.code}/${operation}`;
  const signalPeer = (to,kind,data) => request(endpoint('signal'),{to,kind,data});

  function removePeer(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peer.source?.disconnect();
    peer.pc.close();
    peer.audio?.remove();
    peer.tile?.remove();
    peers.delete(id);
  }
  function videoTile(track,name,self=false) {
    const tile = document.createElement('figure');
    tile.className = self ? 'video-tile self' : 'video-tile';
    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    const caption = document.createElement('figcaption');
    caption.textContent = name;
    tile.append(video,caption);
    $('videos').append(tile);
    return tile;
  }
  function refreshVideos() {
    for (const member of roomParticipants) {
      const peer = peers.get(member.id);
      if (peer?.tile) peer.tile.hidden = !member.camera;
    }
    $('videos').hidden = !$('videos').querySelector('.video-tile:not([hidden])');
  }
  function describePeers() {
    $('peers').replaceChildren(...roomParticipants.map(member => {
      const li = document.createElement('li');
      const state = member.id === session?.id ? ' · vous' : peers.get(member.id)?.pc.connectionState === 'connected' ? ' · connecté' : ' · connexion…';
      li.textContent = member.name + state;
      return li;
    }));
  }
  async function connectPeer(member) {
    if (peers.has(member.id) || member.id === session.id) return;
    const pc = new RTCPeerConnection({iceServers:session.iceServers});
    const peer = {pc,pending:[]};
    peers.set(member.id,peer);
    local.getAudioTracks().forEach(track=>pc.addTrack(track,local));
    const initiator = session.id < member.id;
    if (initiator) {
      peer.videoSender = pc.addTransceiver('video',{direction:'sendrecv'}).sender;
      if (cameraTrack) await peer.videoSender.replaceTrack(cameraTrack);
    }
    pc.onicecandidate = e => { if (e.candidate && session) signalPeer(member.id,'candidate',e.candidate.toJSON()).catch(()=>{}); };
    pc.onconnectionstatechange = () => {
      describePeers();
      if (pc.connectionState === 'failed') status('Audio inaccessible pour un participant. Un relais TURN peut être nécessaire.',true);
    };
    pc.ontrack = e => {
      if (e.track.kind === 'video') {
        peer.tile?.remove();
        peer.tile = videoTile(e.track,member.name);
        refreshVideos();
        return;
      }
      const stream = new MediaStream([e.track]);
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.srcObject = stream;
      $('remote-audio').append(audio);
      peer.audio = audio;
      audio.play().catch(()=>status('Cliquez sur « Activer l’écoute » si le navigateur a coupé le son.'));
      if (host) {
        peer.source = mixer.createMediaStreamSource(stream);
        peer.source.connect(mixOutput);
      }
    };
    if (initiator) {
      await pc.setLocalDescription(await pc.createOffer());
      await signalPeer(member.id,'offer',pc.localDescription.toJSON());
    }
  }
  async function handleSignal(message) {
    const peer = peers.get(message.from);
    if (!peer) return;
    const {pc,pending} = peer;
    if (message.kind === 'candidate') {
      if (pc.remoteDescription) await pc.addIceCandidate(message.data);
      else pending.push(message.data);
      return;
    }
    await pc.setRemoteDescription(message.data);
    for (const candidate of pending.splice(0)) await pc.addIceCandidate(candidate);
    if (message.kind === 'offer') {
      const video = pc.getTransceivers().find(transceiver=>transceiver.receiver.track.kind === 'video');
      if (video) {
        video.direction = 'sendrecv';
        peer.videoSender = video.sender;
        if (cameraTrack) await peer.videoSender.replaceTrack(cameraTrack);
      }
      await pc.setLocalDescription(await pc.createAnswer());
      await signalPeer(message.from,'answer',pc.localDescription.toJSON());
    }
  }
  function recordIndicator(active) {
    $('recording').hidden = !active;
    $('recording').textContent = active ? 'Enregistrement audio en cours' : '';
  }
  function stopCapture() {
    if (stoppingCapture) return stoppingCapture;
    if (recorder?.state !== 'recording') return Promise.resolve();
    stoppingCapture = new Promise(resolve => {
      recorder.addEventListener('stop',resolve,{once:true});
      recorder.stop();
    });
    return stoppingCapture;
  }
  async function poll(current) {
    try {
      const state = await request(endpoint('poll'));
      if (current !== generation) return;
      roomParticipants = state.peers;
      const live = new Set(state.peers.map(member=>member.id));
      for (const id of peers.keys()) if (!live.has(id)) removePeer(id);
      for (const member of state.peers) await connectPeer(member).catch(error=>status(error.message,true));
      for (const message of state.messages) await handleSignal(message).catch(error=>status(error.message,true));
      describePeers();
      refreshVideos();
      recordIndicator(state.recording);
      if (host && state.invite !== session.invite) setInvite(state);
    } catch(error) {
      if (current !== generation) return;
      if (error.status === 403 || error.status === 404) { cleanup(); status('La salle est fermée.'); return; }
      status('Connexion à la salle interrompue. Nouvelle tentative…',true);
    }
    if (current === generation) timer = setTimeout(()=>poll(current),900);
  }
  function cleanup() {
    generation++;
    clearTimeout(timer);
    session = null;
    stopCapture();
    cameraTrack?.stop();
    cameraTrack = null;
    ownVideo?.remove();
    ownVideo = null;
    for (const id of peers.keys()) removePeer(id);
    local?.getTracks().forEach(t=>t.stop());
    mixer?.close().catch(()=>{});
    local = mixer = recorder = stoppingCapture = null;
    $('session').hidden = true;
    document.body.classList.remove('in-call');
    document.querySelector('main').append($('status'));
    $('connect').hidden = false;
    $('connect').querySelector('button').disabled = false;
    $('mute').textContent = 'Couper le micro';
    $('camera').textContent = 'Activer la caméra';
    $('camera').setAttribute('aria-pressed','false');
    $('camera').disabled = false;
    refreshVideos();
    if (host) { $('leave').hidden = false; $('record').hidden = false; $('record').disabled = false; $('finish').hidden = true; $('finish').disabled = false; }
  }
  async function leave() {
    if (!session) return;
    const route = endpoint('leave');
    const active = session;
    cleanup();
    await request(route,{},active).catch(()=>{});
  }
  $('connect').onsubmit = async event => {
    event.preventDefault();
    const button = $('connect').querySelector('button');
    button.disabled = true;
    const guestCode = new URLSearchParams(location.search).get('code');
    if (!host && !/^[\w-]{22}$/.test(guestCode || '')) { status('Ce lien d’invitation est invalide.',true); button.disabled = false; return; }
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Ouvrez le lien HTTPS de la salle dans un navigateur compatible.');
      status('Autorisez le micro pour entrer dans la salle.');
      if (host) mixer = new AudioContext();
      local = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
      if (host) {
        await mixer.resume();
        mixOutput = mixer.createMediaStreamDestination();
        mixer.createMediaStreamSource(local).connect(mixOutput);
      }
      const name = $('name').value;
      session = await request(host ? '/api/rooms' : `/api/rooms/${guestCode}/join`,{name,consent:host || $('consent').checked});
      if (host) setInvite(session);
      $('connect').hidden = true;
      $('session').hidden = false;
      document.body.classList.add('in-call');
      $('call-notices').append($('status'));
      status('');
      poll(++generation);
    } catch (error) {
      cleanup();
      status(error.name === 'NotAllowedError' ? 'Accès au micro refusé.' : error.message,true);
    }
  };
  $('mute').onclick = () => {
    const track = local?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    $('mute').textContent = track.enabled ? 'Couper le micro' : 'Réactiver le micro';
  };
  async function updateCamera(track) {
    await Promise.allSettled(Array.from(peers.values(),peer=>peer.videoSender?.replaceTrack(track)));
    $('camera').textContent = track ? 'Couper la caméra' : 'Activer la caméra';
    $('camera').setAttribute('aria-pressed',String(Boolean(track)));
    refreshVideos();
    await request(endpoint('camera'),{active:Boolean(track)});
  }
  $('camera').onclick = async () => {
    if (!session) return;
    const active = session;
    $('camera').disabled = true;
    try {
      if (cameraTrack) {
        cameraTrack.stop(); cameraTrack = null; ownVideo?.remove(); ownVideo = null;
        await updateCamera(null);
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:360},frameRate:{ideal:18,max:25}}});
        const track = stream.getVideoTracks()[0];
        if (session !== active) { track.stop(); return; }
        cameraTrack = track;
        ownVideo = videoTile(track,'Vous',true);
        track.addEventListener('ended',()=>{ if (cameraTrack === track) $('camera').click(); },{once:true});
        await updateCamera(track);
      }
      status('');
    } catch (error) { if (session === active) status(error.name === 'NotAllowedError' ? 'Accès à la caméra refusé.' : error.message,true); }
    finally { $('camera').disabled = false; }
  };
  function setInvite(value) {
    session.invite = value.invite;
    session.online = value.online;
    $('invite').value = value.invite;
    $('scope').textContent = value.online ? 'Partagez le lien actuel avec les participants. Gardez Réunions Studio ouvert.' : 'Lien de test local. Le lien HTTPS s’affiche dès que la passerelle est prête.';
  }
  $('listen').onclick = () => {
    for (const peer of peers.values()) peer.audio?.play().catch(()=>{});
    status('');
  };
  $('leave').onclick = async () => { await leave(); status(host ? 'Salle fermée.' : 'Vous avez quitté la salle.'); };
  if (host) {
    $('copy').onclick = async () => {
      try { await navigator.clipboard.writeText($('invite').value); status('Lien copié.'); }
      catch { $('invite').select(); status('Copiez le lien sélectionné.'); }
    };
    $('record').onclick = async () => {
      $('record').disabled = true;
      try {
        const active = session;
        await request(endpoint('record'),{active:true});
        if (session !== active) return;
        chunks = [];
        recordedBytes = 0;
        stoppingCapture = null;
        const mimeType = ['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
        recorder = mimeType ? new MediaRecorder(mixOutput.stream,{mimeType,audioBitsPerSecond:48000}) : new MediaRecorder(mixOutput.stream);
        recorder.ondataavailable = event => {
          if (!event.data.size) return;
          chunks.push(event.data);
          recordedBytes += event.data.size;
          if (recordedBytes >= 95*1024*1024 && recorder?.state === 'recording') {
            stopCapture();
            request(endpoint('record'),{active:false}).catch(()=>{});
            recordIndicator(false);
            status('Limite audio atteinte. La salle reste ouverte jusqu’à « Terminer et analyser ».',true);
          }
        };
        recorder.start(1000);
        recordIndicator(true);
        $('record').hidden = true;
        $('finish').hidden = false;
        $('leave').hidden = true;
        status('');
      } catch(error) {
        if (session) request(endpoint('record'),{active:false}).catch(()=>{});
        status(error.message,true);
        $('record').disabled = false;
      }
    };
    $('finish').onclick = async () => {
      if (!recorder) return;
      $('finish').disabled = true;
      const activeRecorder = recorder;
      await stopCapture();
      const audio = new Blob(chunks,{type:activeRecorder.mimeType});
      chunks = [];
      $('leave').hidden = false;
      await leave();
      if (!audio.size) { status('Réunion terminée. Aucun audio enregistré.',true); return; }
      try {
        const draft = await window.RoomDraft.save(audio);
        location.assign(`/?reunion=${encodeURIComponent(draft)}#transcription`);
      } catch {
        const download = document.createElement('a');
        const extension = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm';
        download.href = URL.createObjectURL(audio);
        download.download = `Reunion-en-ligne.${extension}`;
        download.textContent = 'Télécharger l’enregistrement';
        status('Transfert automatique indisponible. Téléchargez l’audio pour l’importer dans l’atelier.',true);
        $('status').append(document.createElement('br'),download);
      }
    };
  }
  window.addEventListener('pagehide',() => {
    if (!session) return;
    fetch(endpoint('leave'),{method:'POST',keepalive:true,headers:{'Content-Type':'application/json',
      'X-Room-Peer':session.id,'X-Room-Token':session.token},body:'{}'}).catch(()=>{});
    cleanup();
  });
})();
