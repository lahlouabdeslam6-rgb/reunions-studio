(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const nlp = window.ReunionNLP;
  const labels = {resume:'Résumé',decisions:'Décisions confirmées',actions:'Actions à réaliser',points_a_confirmer:'Points à confirmer'};
  let file = null, mediaUrl = null, sampleAudio = false;
  let segments = [], history = [], report = null, engine = '';
  let audioTimings = [], clip = null, clipFrame = 0;
  const player = $('player');
  let audioBusy = false, analysisBusy = false, approved = false, revision = 0;
  const timestamp = seconds => {
    const time = Math.max(0,Math.floor(seconds));
    const mm = Math.floor(time/60);
    const tail = `${String(mm%60).padStart(2,'0')}:${String(time%60).padStart(2,'0')}`;
    return mm < 60 ? tail : `${String(Math.floor(mm/60)).padStart(2,'0')}:${tail}`;
  };
  const transcriptLine = row => `${Number.isFinite(row.start) ? `[${timestamp(row.start)}] ` : ''}${row.text}`;
  function element(tag,text,cls) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  function status(id,message,error=false) {
    $(id).textContent = message;
    $(id).classList.toggle('error',error);
  }
  function controls() {
    $('transcribe').disabled = audioBusy || analysisBusy || (!file && !sampleAudio);
    $('choose-audio').disabled = audioBusy;
    $('example').disabled = audioBusy;
    $('open-text').disabled = audioBusy;
    $('meetily').disabled = audioBusy;
    $('meetily-load').disabled = audioBusy || !$('meetily-list').value;
    $('transcript').readOnly = audioBusy;
    $('run').disabled = audioBusy || analysisBusy;
    $('approve').disabled = approved;
    $('markdown').disabled = !approved;
    $('json').disabled = !approved;
  }
  function resetReport() {
    revision++;
    report = null;
    approved = false;
    $('result-content').hidden = true;
    $('empty-result').hidden = false;
    status('status','');
    controls();
  }
  function clearMedia() {
    clearClip();
    audioTimings = [];
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaUrl = null;
    file = null;
    sampleAudio = false;
    player.pause();
    player.removeAttribute('src');
    player.load();
    $('audio-area').hidden = true;
  }
  function selectAudio(next) {
    if (audioBusy || !next) return;
    if (!next.size || next.size > 100*1024*1024 || !(/\.(wav|mp3|m4a|aac|webm|ogg|flac|mp4|opus)$/i.test(next.name) || next.type.startsWith('audio/'))) {
      status('audio-status','Choisissez un enregistrement audio valide de 100 Mo maximum.',true);
      return;
    }
    clearMedia();
    $('transcript').value = '';
    file = next;
    mediaUrl = URL.createObjectURL(next);
    $('player').src = mediaUrl;
    $('filename').textContent = next.name;
    $('audio-area').hidden = false;
    resetReport();
    status('audio-status','Audio prêt à être transcrit.');
  }
  async function streamAudio() {
    audioBusy = true;
    controls();
    const lines = [];
    clearClip();
    audioTimings = [];
    try {
      let input = file;
      if (!input) {
        const sample = await fetch('/exemple.wav');
        if (!sample.ok) throw new Error('Exemple audio indisponible.');
        input = await sample.blob();
        player.pause();
        if (mediaUrl) URL.revokeObjectURL(mediaUrl);
        mediaUrl = URL.createObjectURL(input);
        player.src = mediaUrl;
      }
      $('transcript').value = '';
      resetReport();
      status('audio-status','Chargement du modèle Whisper local…');
      const response = await fetch(`/api/transcribe?language=${encodeURIComponent($('language').value)}`, {
        method:'POST',headers:{'Content-Type':'application/octet-stream'},body:input
      });
      if (!response.ok) throw new Error((await response.json()).error);
      let done = false;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      try {
        while (true) {
          const chunk = await reader.read();
          pending += decoder.decode(chunk.value,{stream:!chunk.done});
          const messages = pending.split('\n');
          pending = messages.pop();
          for (const line of messages) {
            if (!line) continue;
            const event = JSON.parse(line);
            if (event.type === 'error') throw new Error(event.message);
            if (event.type === 'ready') status('audio-status','Whisper transcrit l’enregistrement…');
            if (event.type === 'segment') {
              const text = transcriptLine(event);
              if (lines.join('\n').length + text.length + 1 > nlp.maxInput) throw new Error('Transcription de plus de 50 000 caractères. Analysez l’extrait affiché ou découpez l’audio.');
              lines.push(text);
              audioTimings.push(event);
              $('transcript').value = lines.join('\n');
              $('transcript').scrollTop = $('transcript').scrollHeight;
              status('audio-status',`${lines.length} passage${lines.length>1?'s':''} transcrit${lines.length>1?'s':''}…`);
            }
            if (event.type === 'done') {
              done = true;
              status('audio-status',event.count ? `Transcription terminée · ${event.count} passage(s). Relisez le texte puis lancez l’analyse.` : 'Aucune parole détectée.',!event.count);
            }
          }
          if (chunk.done) break;
        }
        if (!done) throw new Error('La transcription s’est interrompue.');
      } finally { await reader.cancel().catch(()=>{}); }
    } catch (error) {
      status('audio-status',error.message,true);
    } finally { audioBusy = false; controls(); }
  }
  function clearClip() {
    if (clip) clip.abort.abort();
    clip = null;
    cancelAnimationFrame(clipFrame);
  }
  function waitForMedia(event, signal) {
    const wait = AbortSignal.any([signal,AbortSignal.timeout(8000)]);
    return new Promise((resolve,reject) => {
      function cleanup() {
        player.removeEventListener(event,ready);
        player.removeEventListener('error',failed);
        wait.removeEventListener('abort',cancelled);
      }
      function ready() { cleanup(); resolve(); }
      function failed() { cleanup(); reject(new Error('Le navigateur ne peut pas lire ce fichier audio.')); }
      function cancelled() { cleanup(); reject(wait.reason); }
      if (wait.aborted) { cancelled(); return; }
      player.addEventListener(event,ready,{once:true});
      player.addEventListener('error',failed,{once:true});
      wait.addEventListener('abort',cancelled,{once:true});
    });
  }
  const parseTime = text => text.split(':').reduce((n,part)=>n*60+Number(part),0);
  function stopAtClipEnd() {
    if (!clip?.playing || player.currentTime < clip.end) return;
    const end = clip.end;
    clearClip();
    player.pause();
    player.currentTime = end;
  }
  function monitorClip() {
    stopAtClipEnd();
    if (clip?.playing && !player.paused) clipFrame = requestAnimationFrame(monitorClip);
  }
  player.addEventListener('timeupdate',stopAtClipEnd);
  player.addEventListener('play',() => {
    cancelAnimationFrame(clipFrame);
    if (clip?.playing) clipFrame = requestAnimationFrame(monitorClip);
  });
  player.addEventListener('ended',clearClip);
  async function playExcerpt(segment) {
    clearClip();
    player.pause();
    const active = {abort:new AbortController(),playing:false,end:Infinity};
    clip = active;
    const signal = active.abort.signal;
    try {
      if (player.error) throw new Error('Le navigateur ne peut pas lire ce fichier audio.');
      if (player.readyState === 0) await waitForMedia('loadedmetadata',signal);
      const stamped = parseTime(segment.horodatage);
      const matching = audioTimings.filter(t=>timestamp(t.start) === segment.horodatage);
      const timing = matching.find(t=>t.text.includes(segment.texte)) || matching[0];
      const start = timing?.start ?? stamped;
      const next = segments.slice(segment.id).find(s=>s.horodatage && parseTime(s.horodatage)>stamped);
      const fallbackEnd = next ? parseTime(next.horodatage) : player.duration;
      active.end = Math.min(timing?.end ?? fallbackEnd,player.duration);
      if (!(start < active.end)) throw new Error('Ce passage dépasse la durée de l’audio.');
      player.currentTime = start;
      if (player.seeking) await waitForMedia('seeked',signal);
      if (signal.aborted) return;
      if (Math.abs(player.currentTime-start) > .15) throw new Error('Ce fichier ne permet pas d’accéder à ce passage.');
      active.playing = true;
      await player.play();
      if (!signal.aborted) status('audio-status',`Extrait · ${timestamp(start)}–${timestamp(active.end)}`);
    } catch (error) {
      if (signal.aborted) return;
      clearClip();
      status('audio-status',error.message,true);
    }
  }
  function evidence(id) {
    const s = segments[id-1];
    const row = element('div',undefined,'evidence');
    if (s.horodatage && !$('audio-area').hidden) {
      const button = element('button',`▶ ${s.horodatage}`);
      button.type = 'button';
      button.title = 'Écouter ce passage';
      button.onclick = () => playExcerpt(s);
      row.append(button);
    } else row.append(element('span',s.horodatage || `#${id}`));
    row.append(element('span',`${s.locuteur ? `${s.locuteur} · `:''}${s.texte}`));
    return row;
  }
  function renderHistory() {
    const panel = $('history');
    panel.replaceChildren();
    if (!history.length) return;
    panel.className = 'history';
    panel.append(element('h3','Historique des décisions'));
    for (const item of history) {
      const card = element('div',undefined,'timeline');
      card.append(element('h4',item.title));
      const list = element('ol');
      for (const event of item.events) {
        const li = element('li');
        const label = event.id === item.current ? 'Retenu' : event.type === 'Validation' && item.conflict ? 'À vérifier' : event.type;
        li.append(element('span',label,`tag ${label === 'Retenu'?'current':label === 'À vérifier'?'conflict':''}`),document.createTextNode(event.deadline),evidence(event.id));
        list.append(li);
      }
      card.append(list);
      if (item.conflict) card.append(element('p','Les validations se contredisent. Vérifiez les passages avant de retenir une date.','status error'));
      panel.append(card);
    }
  }
  function field(row,key,title,placeholder) {
    const label = element('label',title);
    const input = element('input');
    input.value = row[key] ?? '';
    input.placeholder = placeholder;
    input.oninput = () => {
      row[key] = input.value.trim() || (key === 'texte' ? '' : null);
      approved = false;
      $('review').textContent = 'Modifications en attente de validation.';
      renderMetrics();
      controls();
    };
    label.append(input);
    return label;
  }
  function renderMetrics() {
    $('metrics').replaceChildren();
    const missing = report.actions.filter(x=>!x.responsable || !x.echeance).length;
    for (const [name,count] of [['Décisions',report.decisions.length],['Actions',report.actions.length],['Actions à compléter',missing]]) {
      const card = element('div'); card.append(element('strong',String(count)),document.createTextNode(name)); $('metrics').append(card);
    }
  }
  function render() {
    renderMetrics();
    renderHistory();
    $('sections').replaceChildren();
    for (const key of nlp.keys) {
      const section = element('section',undefined,'report-section');
      section.append(element('h3',labels[key]));
      if (!report[key].length) section.append(element('p','Aucun élément détecté.','status'));
      for (const row of report[key]) {
        const card = element('div',undefined,'row');
        const fields = element('div',undefined,key === 'actions' ? 'row-fields' : '');
        fields.append(field(row,'texte',key === 'actions' ? 'Tâche' : 'Texte','Texte manquant'));
        if (key === 'actions') fields.append(field(row,'responsable','Responsable','Non précisé'),field(row,'echeance','Échéance','Non précisée'));
        card.append(fields,...row.segments.map(evidence));
        section.append(card);
      }
      $('sections').append(section);
    }
    $('result-content').hidden = false;
    $('empty-result').hidden = true;
    $('review').textContent = 'Relisez les extraits et corrigez les champs avant de valider.';
  }
  async function analyze() {
    resetReport();
    const token = revision;
    analysisBusy = true;
    controls();
    const transcript = $('transcript').value;
    const useAI = $('mode').value === 'ai';
    status('status',useAI ? 'Analyse en cours avec Qwen…' : 'Analyse locale en cours…');
    try {
      const source = nlp.segment(transcript);
      let result;
      if (useAI) {
        const response = await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({transcript})});
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        result = nlp.checkResult(data.report,source);
      } else result = nlp.analyzeRules(source);
      if (token !== revision) return;
      segments = source;
      report = result;
      history = window.DecisionHistory.build(source);
      engine = useAI ? 'Qwen via Ollama' : 'Règles locales';
      render();
      status('status',`${source.length} passage(s) analysé(s) · ${engine}`);
      $('result').scrollIntoView({block:'start'});
    } catch (error) { if (token === revision) status('status',error.message,true); }
    finally { analysisBusy = false; controls(); }
  }
  async function meetily(id) {
    const response = await fetch(`/api/meetily${id ? '?id='+encodeURIComponent(id):''}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data;
  }
  $('meetily').onclick = async () => {
    $('meetily-box').hidden = false;
    $('meetily-list').replaceChildren();
    controls();
    status('meetily-status','Recherche des réunions locales…');
    try {
      const data = await meetily();
      for (const meeting of data.meetings) {
        const option = element('option',meeting.title || 'Réunion sans titre'); option.value = meeting.id; $('meetily-list').append(option);
      }
      status('meetily-status',data.meetings.length ? `${data.meetings.length} réunion(s) disponible(s).` : data.available ? 'Aucune réunion enregistrée.' : 'Base Meetily introuvable sur cet ordinateur. Vous pouvez importer un audio ou un fichier texte.');
    } catch (error) { status('meetily-status',error.message,true); }
    finally { controls(); }
  };
  $('meetily-list').onchange = controls;
  $('meetily-load').onclick = async () => {
    const token = revision;
    try {
      const data = await meetily($('meetily-list').value);
      if (token !== revision || audioBusy) return;
      if (!data.segments.length) throw new Error('Cette réunion ne contient aucune transcription.');
      clearMedia();
      $('transcript').value = data.segments.map(transcriptLine).join('\n');
      resetReport();
      status('meetily-status',`${data.segments.length} passages importés depuis Meetily.`);
      $('transcription').scrollIntoView({block:'start'});
    } catch (error) { status('meetily-status',error.message,true); }
  };
  $('choose-audio').onclick = () => $('audio-file').click();
  $('audio-file').onchange = e => { selectAudio(e.target.files[0]); e.target.value = ''; };
  document.addEventListener('dragover',event => { if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault(); });
  document.addEventListener('drop',event => { if (event.dataTransfer.files.length) event.preventDefault(); });
  $('drop').ondragover = event => { event.preventDefault(); $('drop').classList.add('hover'); };
  $('drop').ondragleave = () => $('drop').classList.remove('hover');
  $('drop').ondrop = event => { event.preventDefault(); $('drop').classList.remove('hover'); selectAudio(event.dataTransfer.files[0]); };
  $('transcribe').onclick = streamAudio;
  $('example').onclick = () => {
    clearMedia();
    sampleAudio = true;
    $('player').src = '/exemple.wav';
    $('filename').textContent = 'Exemple audio · Réunion fictive';
    $('audio-area').hidden = false;
    $('language').value = 'fr';
    $('transcript').value = '';
    resetReport();
    status('audio-status','Exemple prêt. Cliquez sur « Transcrire l’audio ».');
  };
  $('open-text').onclick = () => $('text-file').click();
  $('text-file').onchange = async event => {
    const next = event.target.files[0];
    if (!next) return;
    const token = revision;
    try {
      if (next.size > 200003) throw new Error('Fichier texte trop volumineux.');
      const text = new TextDecoder('utf-8',{fatal:true}).decode(await next.arrayBuffer());
      if (text.length > nlp.maxInput) throw new Error('Le fichier dépasse 50 000 caractères.');
      if (token === revision && !audioBusy) { clearMedia(); $('transcript').value = text; resetReport(); }
    } catch(error) { status('status',error.message,true); }
    finally { event.target.value = ''; }
  };
  $('transcript').oninput = resetReport;
  $('mode').onchange = resetReport;
  $('run').onclick = analyze;
  $('approve').onclick = () => {
    if (!report || nlp.keys.some(key=>report[key].some(row=>!row.texte))) {
      $('review').textContent = 'Complétez les champs de texte vides avant de valider.'; return;
    }
    approved = true; $('review').textContent = 'Compte rendu validé.'; controls();
  };
  function download(name,mime,text) {
    const url = URL.createObjectURL(new Blob([text],{type:mime}));
    const link = element('a'); link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  $('json').onclick = () => {
    if (!approved) return;
    const refs = new Set([...nlp.keys.flatMap(key=>report[key].flatMap(row=>row.segments)),...history.flatMap(item=>item.events.map(e=>e.id))]);
    download('compte-rendu.json','application/json',JSON.stringify({moteur:engine,...report,historique:history,sources:segments.filter(s=>refs.has(s.id))},null,2));
  };
  const escape = value => String(value).replace(/[\\`*_{}\[\]()#+!<>|]/g,'\\$&');
  $('markdown').onclick = () => {
    if (!approved) return;
    const markdown = ['# Compte rendu',`Mode : ${engine}`,...nlp.keys.flatMap(key=>[`## ${labels[key]}`,
      ...report[key].map(row=>`- ${escape(row.texte)}${key === 'actions' ? ` · ${escape(row.responsable ?? 'Responsable non précisé')} · ${escape(row.echeance ?? 'Échéance non précisée')}`:''}\n${row.segments.map(id=>`  - ${escape(evidence(id).textContent)}`).join('\n')}`)]),
    ...history.flatMap(row=>[`## Historique · ${row.title}`,...row.events.map(e=>`- ${e.id === row.current ? 'Retenu' : e.type} · ${escape(e.deadline)} · ${escape(evidence(e.id).textContent)}`)])].join('\n\n');
    download('compte-rendu.md','text/markdown;charset=utf-8',markdown);
  };
  controls();
})();
