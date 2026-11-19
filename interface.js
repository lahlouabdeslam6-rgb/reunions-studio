(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const nlp = window.ReunionNLP;
  const labels = {resume:'Résumé',decisions:'Décisions confirmées',actions:'Actions à réaliser',points_a_confirmer:'Points à confirmer'};
  let file = null, mediaUrl = null, sampleAudio = false;
  let segments = [], history = [], report = null, engine = '';
  let audioTimings = [], clip = null, clipFrame = 0;
  const languageNames = new Intl.DisplayNames(['fr'],{type:'language'});
  const player = $('player');
  let audioBusy = false, analysisBusy = false, approved = false, revision = 0;
  let transcriptTranslationBusy = false, transcriptTranslationSource = null;
  let activeMeeting = null, saveVersion = 0, latestSave = null;
  let meetingToDelete = null;
  const library = window.MeetingLibrary;
  const meetingDate = new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'});
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
  function meetingUrl(id) {
    return '/?dossier='+encodeURIComponent(id);
  }
  function startMeeting(title, id = crypto.randomUUID()) {
    activeMeeting = {id,createdAt:Date.now(),stored:false};
    $('meeting-title').value = title.slice(0,120);
    status('save-status','');
  }
  function saveMeeting() {
    const transcript = $('transcript').value;
    if (!activeMeeting && !file && !sampleAudio && !transcript.trim()) return;
    if (!activeMeeting) startMeeting($('meeting-title').value || 'Réunion du '+meetingDate.format(new Date()));
    const current = activeMeeting;
    const version = ++saveVersion;
    const record = structuredClone({
      id:current.id,createdAt:current.createdAt,
      title:$('meeting-title').value.trim() || 'Réunion du '+meetingDate.format(current.createdAt),
      audioName:file || sampleAudio ? $('filename').textContent : '',
      sampleAudio,transcript,audioTimings,report,approved,engine,
      language:$('language').value,mode:$('mode').value
    });
    status('save-status','Sauvegarde en cours…');
    const saved = library.save(record,!current.stored,current.stored ? null : file).then(stored => {
      if (stored) current.stored = true;
      if (activeMeeting === current && version === saveVersion) {
        if (stored) {
          const url = meetingUrl(current.id)+location.hash;
          if (url !== location.pathname+location.search+location.hash) window.history.replaceState(null,'',url);
          status('save-status','Sauvegardée dans l’historique.');
        } else status('save-status','Cette réunion ne figure plus dans l’historique.',true);
      }
      return stored;
    }).catch(() => {
      if (activeMeeting === current && version === saveVersion) {
        status('save-status','Sauvegarde impossible. Vérifiez l’espace disponible et les paramètres du navigateur.',true);
      }
      return false;
    });
    latestSave = saved;
    return saved;
  }
  function controls() {
    $('transcribe').disabled = audioBusy || analysisBusy || (!file && !sampleAudio);
    $('choose-audio').disabled = audioBusy;
    $('example').disabled = audioBusy;
    $('open-text').disabled = audioBusy || analysisBusy;
    $('meetily').disabled = audioBusy;
    $('meetily-load').disabled = audioBusy || !$('meetily-list').value;
    $('transcript').readOnly = audioBusy;
    for (const id of ['translate-transcript','translate-selection']) {
      $(id).disabled = audioBusy || !$('transcript').value.trim() || transcriptTranslationBusy;
    }
    $('run').disabled = audioBusy || analysisBusy;
    $('approve').disabled = approved;
    $('markdown').disabled = !approved;
    $('json').disabled = !approved;
  }
  function resetReport() {
    revision++;
    if ($('transcript').value !== transcriptTranslationSource) $('transcript-translation').hidden = true;
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
  function selectAudio(next, meetingId) {
    if (audioBusy || !next) return;
    if (!next.size || next.size > 100*1024*1024 || !(/\.(wav|mp3|m4a|aac|webm|ogg|flac|mp4|opus)$/i.test(next.name) || next.type.startsWith('audio/'))) {
      status('audio-status','Choisissez un enregistrement audio valide de 100 Mo maximum.',true);
      return;
    }
    clearMedia();
    $('transcript').value = '';
    startMeeting($('meeting-title').value.trim() && !activeMeeting ? $('meeting-title').value.trim() : next.name.replace(/\.[^.]+$/,''),meetingId);
    showAudio(next,next.name);
    resetReport();
    const saved = saveMeeting();
    status('audio-status','Audio prêt à être transcrit.');
    return saved;
  }
  function showAudio(next, name) {
    file = next;
    sampleAudio = !next;
    mediaUrl = next ? URL.createObjectURL(next) : null;
    player.src = mediaUrl || '/exemple.wav';
    $('filename').textContent = name;
    $('audio-area').hidden = false;
  }
  async function streamAudio() {
    audioBusy = true;
    controls();
    const lines = [];
    let succeeded = false;
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
      status('audio-status','Chargement du modèle Whisper local…');
      const response = await fetch(`/api/transcribe?language=${encodeURIComponent($('language').value)}`, {
        method:'POST',headers:{'Content-Type':'application/octet-stream'},body:input
      });
      if (!response.ok) {
        const failure = await response.json().catch(()=>({}));
        throw new Error(failure.error || 'Le serveur audio est indisponible. Relancez Réunions Studio.');
      }
      if (!response.headers.get('content-type')?.includes('application/x-ndjson')) throw new Error('Le serveur audio semble ancien. Relancez Réunions Studio.');
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
              if (!lines.length) {
                clearClip();
                audioTimings = [];
              }
              lines.push(text);
              audioTimings.push(event);
              $('transcript').value = lines.join('\n');
              if (lines.length === 1) resetReport();
              saveMeeting();
              $('transcript').scrollTop = $('transcript').scrollHeight;
              status('audio-status',`${lines.length} passage${lines.length>1?'s':''} transcrit${lines.length>1?'s':''}…`);
            }
            if (event.type === 'done') {
              done = true;
              succeeded = event.count > 0;
              if (event.count && event.language !== 'fr') $('mode').value = 'ai';
              if (event.count) saveMeeting();
              const language = event.language ? ` · ${languageNames.of(event.language)}` : '';
              status('audio-status',event.count ? `Transcription terminée · ${event.count} passage(s)${language}. Relisez le texte puis lancez l’analyse.` : 'Aucune parole détectée. Vérifiez le micro et la langue choisie.',!event.count);
            }
          }
          if (chunk.done) break;
        }
        if (!done) throw new Error('La transcription s’est interrompue.');
      } finally { await reader.cancel().catch(()=>{}); }
    } catch (error) {
      status('audio-status',error.message,true);
    } finally { audioBusy = false; controls(); }
    return succeeded;
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
      label.closest('.report-section')?.dispatchEvent(new Event('report-edit'));
      saveMeeting();
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
  async function translateText(parts, language, shouldTranslate) {
    const passages = parts.filter(shouldTranslate).map(part => part.text);
    const response = await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({passages,language})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    let index = 0;
    return parts.map(part => shouldTranslate(part) ? data.translations[index++] : part.text).join('');
  }
  function showTranslation(output,message,language='fr',error=false) {
    output.hidden = false;
    output.textContent = message;
    output.lang = language;
    output.dir = language === 'ar' ? 'rtl' : 'ltr';
    output.classList.toggle('error',error);
  }
  async function translateTranscript(selectionOnly) {
    const input = $('transcript');
    const output = $('transcript-translation');
    const original = input.value;
    const start = input.selectionStart, end = input.selectionEnd;
    const selected = original.slice(start,end);
    transcriptTranslationSource = original;
    if (selectionOnly && !selected.trim()) {
      showTranslation(output,'Sélectionnez les mots en anglais dans la transcription, puis cliquez sur « Traduire la sélection ».','fr',true);
      input.focus();
      return;
    }
    const parts = nlp.translationPassages(selectionOnly ? selected : original,!selectionOnly);
    const isEnglish = part => selectionOnly ? Boolean(part.text.trim()) : part.language === 'en';
    if (!parts.some(isEnglish)) {
      showTranslation(output,'Aucune phrase anglaise détectée. Vous pouvez sélectionner les mots à traduire.','fr',true);
      return;
    }
    transcriptTranslationBusy = true;
    controls();
    showTranslation(output,'Traduction locale en cours…');
    try {
      const translated = await translateText(parts,'fr',isEnglish);
      if (input.value === original) {
        const result = selectionOnly ? original.slice(0,start)+translated+original.slice(end) : translated;
        showTranslation(output,result);
      }
    } catch (error) {
      if (input.value === original) showTranslation(output,error.message,'fr',true);
    } finally {
      transcriptTranslationBusy = false;
      controls();
    }
  }
  function summaryHeading(section) {
    const heading = element('div',undefined,'summary-heading');
    heading.append(element('h3',labels.resume));
    if (!report.resume.length) { section.append(heading); return; }
    const text = element('p',undefined,'translation');
    text.hidden = true;
    text.setAttribute('aria-live','polite');
    const group = element('div',undefined,'translation-controls');
    group.setAttribute('aria-label','Traduire le résumé');
    heading.append(group);
    section.append(heading,text);
    function refreshButtons() {
      text.hidden = true;
      const original = report.resume.map(row=>row.texte).filter(Boolean).join('\n\n');
      const parts = nlp.translationPassages(original);
      const sources = new Set(parts.map(part => part.language).filter(Boolean));
      if (!sources.size && original.trim()) {
        for (const segment of segments) {
          for (const {language} of nlp.translationPassages(segment.texte)) {
            if (language) sources.add(language);
          }
        }
        if (!sources.size) sources.add('fr');
      }
      const mixedFrenchEnglish = parts.some(part => part.language === 'fr') && parts.some(part => part.language === 'en');
      const buttons = Object.entries({fr:mixedFrenchEnglish ? 'Anglais → Français' : 'Français',en:'Anglais',ar:'العربية'})
        .filter(([code]) => original.trim() && (sources.size !== 1 || !sources.has(code)))
        .map(([code,name]) => {
          const button = element('button',name);
          button.type = 'button';
          button.setAttribute('aria-pressed','false');
          button.onclick = async () => {
            buttons.forEach(control=>{ control.disabled = true; control.setAttribute('aria-pressed','false'); });
            showTranslation(text,'Traduction locale en cours…');
            const selective = code === 'fr' && mixedFrenchEnglish;
            const shouldTranslate = part => selective ? part.language === 'en' : Boolean(part.text.trim()) && part.language !== code;
            try {
              const result = await translateText(parts,code,shouldTranslate);
              if (group.contains(button)) {
                showTranslation(text,result,code);
                button.setAttribute('aria-pressed','true');
              }
            } catch (error) {
              if (group.contains(button)) showTranslation(text,error.message,'fr',true);
            } finally {
              buttons.forEach(control=>{ control.disabled = false; });
            }
          };
          return button;
        });
      group.replaceChildren(...buttons);
    }
    section.addEventListener('report-edit',refreshButtons);
    refreshButtons();
  }
  function render() {
    renderMetrics();
    renderHistory();
    $('sections').replaceChildren();
    for (const key of nlp.keys) {
      const section = element('section',undefined,'report-section');
      if (key === 'resume') summaryHeading(section);
      else section.append(element('h3',labels[key]));
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
      approved = false;
      history = window.DecisionHistory.build(source);
      engine = useAI ? 'Qwen via Ollama' : 'Règles locales';
      render();
      saveMeeting();
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
      startMeeting($('meetily-list').selectedOptions[0]?.textContent || 'Réunion Meetily');
      $('transcript').value = data.segments.map(transcriptLine).join('\n');
      resetReport();
      saveMeeting();
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
    startMeeting('Réunion fictive');
    showAudio(null,'Exemple audio · Réunion fictive');
    $('language').value = 'fr';
    $('transcript').value = '';
    resetReport();
    saveMeeting();
    status('audio-status','Exemple prêt. Cliquez sur « Transcrire l’audio ».');
  };
  $('open-text').onclick = () => $('text-file').click();
  $('text-file').onchange = async event => {
    const next = event.target.files[0];
    if (!next) return;
    const token = revision;
    try {
      const pdf = next.type === 'application/pdf' || /\.pdf$/i.test(next.name);
      let text;
      if (pdf) {
        if (next.size > 15*1024*1024) throw new Error('Le PDF dépasse 15 Mo.');
        status('status','Lecture du PDF en cours…');
        const response = await fetch('/api/pdf',{method:'POST',headers:{'Content-Type':'application/pdf'},body:next});
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        text = data.text;
      } else {
        if (next.size > 200003) throw new Error('Fichier texte trop volumineux.');
        text = new TextDecoder('utf-8',{fatal:true}).decode(await next.arrayBuffer());
      }
      if (text.length > nlp.maxInput) throw new Error('Le fichier dépasse 50 000 caractères.');
      if (token === revision && !audioBusy && !analysisBusy) {
        clearMedia();
        startMeeting(next.name.replace(/\.[^.]+$/,''));
        $('transcript').value = text;
        resetReport();
        if (pdf) $('mode').value = 'ai';
        saveMeeting();
        status('status',`${next.name} importé. Cliquez sur « Analyser la réunion ».`);
      }
    } catch(error) { status('status',error.message,true); }
    finally { event.target.value = ''; }
  };
  $('transcript').oninput = () => { resetReport(); saveMeeting(); };
  $('mode').onchange = saveMeeting;
  $('language').onchange = saveMeeting;
  $('meeting-title').oninput = saveMeeting;
  $('translate-transcript').onclick = () => translateTranscript(false);
  $('translate-selection').onclick = () => translateTranscript(true);
  $('run').onclick = analyze;
  $('approve').onclick = () => {
    if (!report || nlp.keys.some(key=>report[key].some(row=>!row.texte))) {
      $('review').textContent = 'Complétez les champs de texte vides avant de valider.'; return;
    }
    approved = true; $('review').textContent = 'Compte rendu validé.'; controls();
    saveMeeting();
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
  function restoreMeeting(record) {
    activeMeeting = {id:record.id,createdAt:record.createdAt,stored:true};
    $('meeting-title').value = record.title;
    $('transcript').value = record.transcript;
    $('language').value = record.language;
    $('mode').value = record.mode;
    if (record.sampleAudio || record.audio instanceof Blob) showAudio(record.audio,record.audioName);
    audioTimings = record.audioTimings;
    if (record.report) {
      segments = nlp.segment(record.transcript);
      report = record.report;
      history = window.DecisionHistory.build(segments);
      engine = record.engine;
      approved = record.approved;
      render();
      if (approved) $('review').textContent = 'Compte rendu validé.';
    }
    status('save-status','Sauvegardée dans l’historique.');
    window.history.replaceState(null,'',meetingUrl(record.id)+location.hash);
  }
  async function resumeMeeting(id) {
    try {
      const existing = await library.load(id);
      if (existing) {
        restoreMeeting(existing);
        await window.RoomDraft.remove(id).catch(()=>{});
        return;
      }
      const audio = await window.RoomDraft.load(id);
      if (!(audio instanceof Blob) || !audio.size) throw new Error('Enregistrement de la réunion introuvable.');
      const extension = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm';
      const saved = await selectAudio(new File([audio],`Réunion en ligne.${extension}`,{type:audio.type}),id);
      if (saved) await window.RoomDraft.remove(id).catch(()=>{});
      $('workshop').inert = false;
      $('transcription').scrollIntoView({block:'start'});
      if (await streamAudio()) await analyze();
    } catch (error) { status('status',error.message,true); }
  }
  function confirmMeetingDeletion(record) {
    meetingToDelete = record;
    $('delete-meeting-title').textContent = record.title;
    $('delete-meeting-status').textContent = '';
    $('delete-meeting').showModal();
  }
  $('cancel-delete').onclick = () => $('delete-meeting').close();
  $('delete-meeting').oncancel = event => {
    if ($('confirm-delete').disabled) event.preventDefault();
  };
  $('delete-meeting-form').onsubmit = async event => {
    event.preventDefault();
    const confirm = $('confirm-delete');
    if (!meetingToDelete || confirm.disabled) return;
    const cardIndex = [...$('meeting-list').children].findIndex(card => card.dataset.id === meetingToDelete.id);
    const cancel = $('cancel-delete');
    confirm.disabled = cancel.disabled = true;
    try {
      await library.remove(meetingToDelete.id);
      $('delete-meeting').close();
      await renderLibrary();
      const cards = $('meeting-list').children;
      const next = cards[Math.min(cardIndex,cards.length-1)]?.querySelector('.meeting-card');
      (next || $('library-new-meeting')).focus();
    } catch {
      $('delete-meeting-status').textContent = 'La suppression a échoué. Réessayez.';
    } finally {
      confirm.disabled = cancel.disabled = false;
    }
  };
  async function renderLibrary() {
    try {
      const records = await library.archive();
      const cards = records.map(record => {
        const card = element('li',undefined,'meeting-item');
        card.dataset.id = record.id;
        const link = element('a',undefined,'meeting-card');
        const section = record.report ? 'result' : record.audioName ? 'recording' : 'transcription';
        link.href = meetingUrl(record.id)+'#'+section;
        const title = element('strong',record.title);
        const date = element('time',meetingDate.format(record.createdAt));
        date.dateTime = new Date(record.createdAt).toISOString();
        const meta = element('span',undefined,'meeting-card-meta');
        if (record.audioName) meta.append(element('span',record.audioName,'tag'));
        if (record.transcript.trim()) meta.append(element('span','Transcription','tag'));
        if (record.report) meta.append(element('span',record.approved ? 'Compte rendu validé' : 'Compte rendu','tag current'));
        const preview = record.report?.resume.find(row=>row.texte)?.texte || record.transcript;
        link.append(title,date,meta);
        if (preview) link.append(element('span',preview.slice(0,140)+(preview.length > 140 ? '…' : ''),'meeting-preview'));
        const remove = element('button','Supprimer','danger remove-meeting');
        remove.type = 'button';
        remove.setAttribute('aria-label','Supprimer '+record.title);
        remove.onclick = () => confirmMeetingDeletion(record);
        card.append(link,remove);
        return card;
      });
      $('meeting-list').replaceChildren(...cards);
      status('library-status',records.length ? '' : 'Aucune réunion enregistrée. Ajoutez un audio ou une transcription dans l’atelier.');
    } catch {
      status('library-status','Historique inaccessible dans ce navigateur.',true);
    }
  }
  async function init() {
    if (location.pathname === '/historique') {
      $('workshop').hidden = true;
      $('meeting-library').hidden = false;
      $('library-link').setAttribute('aria-current','page');
      $('meetily').hidden = true;
      for (const link of document.querySelectorAll('.sidebar a[href^="#"]')) link.href = '/'+link.getAttribute('href');
      document.title = 'Historique · Réunions Studio';
      window.addEventListener('pageshow',event=>{ if (event.persisted) renderLibrary(); });
      await renderLibrary();
      return;
    }
    for (const id of ['library-link','new-meeting']) {
      $(id).addEventListener('click',async event => {
        if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !latestSave) return;
        event.preventDefault();
        await latestSave;
        location.assign($(id).href);
      });
    }
    try {
      const query = new URLSearchParams(location.search);
      const draft = query.get('reunion');
      const requested = query.get('dossier');
      if (draft && /^[a-f0-9-]{36}$/.test(draft)) await resumeMeeting(draft);
      else if (!query.has('nouvelle')) {
        const id = requested || (await library.archive())[0]?.id;
        if (id) {
          const record = await library.load(id);
          if (record) restoreMeeting(record);
          else status('save-status','Cette réunion ne figure plus dans l’historique.',true);
        }
      }
      if (location.hash === '#result' && report) $('result').scrollIntoView({block:'start'});
      else if (['#recording','#transcription'].includes(location.hash)) {
        $(location.hash.slice(1)).scrollIntoView({block:'start'});
      }
    } catch {
      status('save-status','Impossible de rouvrir la réunion sauvegardée.',true);
    } finally {
      $('workshop').inert = false;
      controls();
    }
  }
  controls();
  init();
})();
