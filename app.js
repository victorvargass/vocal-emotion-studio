(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'vocal-emotion-studio-v2';
  const LEGACY_KEY = 'vocal-emotion-studio-v1';
  const emotions = [
    ['Vulnerable', '#9a6d83'], ['Nostalgia', '#786a9b'], ['Esperanza', '#66806e'],
    ['Amor', '#b36d59'], ['Alegría', '#b38b37'], ['Rabia', '#a84e4e'],
    ['Miedo', '#697987'], ['Determinación', '#9b6244']
  ];
  const dynamics = ['Natural', 'Íntimo', 'Suave', 'Creciendo', 'Intenso', 'Soltar'];
  const actions = ['Ninguno', 'Respirar antes', 'Pausa', 'Sostener', 'Susurrar', 'Voz aireada', 'Mirar al público'];
  const colorFor = emotion => emotions.find(([name]) => name === emotion)?.[1] || '#8a7467';

  let state = {
    id: `song-${Date.now()}`,
    title: $('songTitle').value,
    lyrics: $('lyricsInput').value,
    bpm: 76,
    meter: '4/4',
    metronomeEnabled: true,
    metronomeVolume: 0.55,
    beatsPerLine: 4,
    annotations: [],
    timestamps: [],
    updatedAt: Date.now()
  };
  let lines = [], tokens = [], selection = null, anchor = null, editingId = null;
  let mobileSelecting = false, mobileStart = null;
  let noteDraft = { emotion: '', dynamic: 'Natural', action: 'Ninguno' };
  let audioUrl = null, audioFileName = '';
  let rehearsal = { playing: false, line: 0, elapsed: 0, startedAt: 0, raf: 0, countTimer: 0 };
  let metronome = { context: null, timer: 0, nextTime: 0, beat: 0 };
  let saveTimer = 0, toastTimer = 0;

  function parseLyrics(text) {
    let tokenIndex = 0;
    lines = text.split('\n').map((raw, lineIndex) => {
      const words = raw.match(/\S+/g) || [];
      return { raw, lineIndex, words: words.map(word => ({ word, lineIndex, index: tokenIndex++ })) };
    });
    tokens = lines.flatMap(line => line.words);
  }

  function phrase(start, end) {
    return tokens.slice(start, end + 1).map(token => token.word).join(' ');
  }

  function annotationLabel(mark) {
    return [mark.emotion, mark.dynamic !== 'Natural' ? mark.dynamic : '', mark.action !== 'Ninguno' ? mark.action : '', mark.note].filter(Boolean).join(' · ') || 'Indicación';
  }

  function sanitizeSong(raw) {
    const lyrics = typeof raw?.lyrics === 'string' ? raw.lyrics : '';
    parseLyrics(lyrics);
    const annotations = (raw.annotations || raw.marks || []).filter(mark =>
      Number.isInteger(mark.start) && Number.isInteger(mark.end) && mark.start >= 0 && mark.end >= mark.start && mark.end < tokens.length
    ).map((mark, index) => ({
      id: mark.id || `note-${Date.now()}-${index}`,
      start: mark.start, end: mark.end,
      emotion: mark.emotion || '',
      dynamic: mark.dynamic || mark.intensity || 'Natural',
      action: mark.action || (mark.technique && mark.technique !== 'Natural' ? mark.technique : 'Ninguno'),
      note: mark.note || ''
    }));
    return {
      id: String(raw.id || `song-${Date.now()}`),
      title: String(raw.title || 'Sin título'), lyrics,
      bpm: clamp(Number(raw.bpm) || 76, 40, 240),
      meter: ['2/4', '3/4', '4/4', '6/8'].includes(raw.meter) ? raw.meter : '4/4',
      metronomeEnabled: raw.metronomeEnabled !== false,
      metronomeVolume: clamp(Number.isFinite(Number(raw.metronomeVolume)) ? Number(raw.metronomeVolume) : 0.55, 0, 1),
      beatsPerLine: [2, 4, 8, 16].includes(Number(raw.beatsPerLine)) ? Number(raw.beatsPerLine) : 4,
      annotations,
      timestamps: Array.isArray(raw.timestamps) ? raw.timestamps.map(value => Number.isFinite(Number(value)) ? Number(value) : null) : [],
      updatedAt: Number(raw.updatedAt) || Date.now()
    };
  }

  function getLibrary() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  function writeLibrary(songs) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(songs)); return true; }
    catch { showToast('No pude guardar en este navegador. Descarga una copia.'); return false; }
  }

  function persist(immediate = false) {
    $('savedState').textContent = 'Guardando…';
    clearTimeout(saveTimer);
    const save = () => {
      state.updatedAt = Date.now();
      const songs = getLibrary();
      const index = songs.findIndex(song => song.id === state.id);
      if (index >= 0) songs[index] = state; else songs.unshift(state);
      if (writeLibrary(songs)) $('savedState').textContent = 'Guardado';
    };
    if (immediate) save(); else saveTimer = setTimeout(save, 450);
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  }
  function showToast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2600);
  }

  function updateEditorFromState() {
    $('songTitle').value = state.title;
    $('lyricsInput').value = state.lyrics;
    $('displayTitle').textContent = state.title;
    $('bpmInput').value = state.bpm;
    $('meterInput').value = state.meter;
    $('metronomeEnabled').checked = state.metronomeEnabled;
    $('metronomeVolume').value = Math.round(state.metronomeVolume * 100);
    $('metronomeVolumeValue').textContent = `${Math.round(state.metronomeVolume * 100)}%`;
    $('beatsInput').value = state.beatsPerLine;
    syncMetronomeControls();
    parseLyrics(state.lyrics);
    updateCount();
    clearSelection(false);
    renderScore();
    updateSyncSummary();
  }

  function updateCount() {
    const text = $('lyricsInput').value;
    const lineCount = text ? text.split('\n').filter(line => line.trim()).length : 0;
    const wordCount = text.match(/\S+/g)?.length || 0;
    $('lyricsCount').textContent = `${lineCount} ${lineCount === 1 ? 'línea' : 'líneas'} · ${wordCount} ${wordCount === 1 ? 'palabra' : 'palabras'}`;
  }

  function setMode(mode) {
    if (mode === 'rehearse') { enterRehearsal(); return; }
    stopRehearsal();
    document.querySelectorAll('.mode-panel').forEach(panel => { panel.hidden = panel.dataset.panel !== mode; });
    document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderScore() {
    const score = $('lyricsScore');
    score.replaceChildren();
    lines.forEach(line => {
      const row = document.createElement('div');
      row.className = `score-line${line.words.length ? '' : ' blank'}`;
      row.dataset.line = line.lineIndex;
      if (!line.words.length) row.append('\u00a0');
      line.words.forEach((token, wordIndex) => {
        const marks = state.annotations.filter(mark => mark.start <= token.index && mark.end >= token.index);
        const word = document.createElement('span');
        word.className = `word${selection && token.index >= selection.start && token.index <= selection.end ? ' selected' : ''}${marks.length ? ' annotated' : ''}`;
        word.dataset.index = token.index;
        word.tabIndex = 0;
        word.textContent = token.word;
        if (marks.length) {
          word.style.setProperty('--mark-color', colorFor(marks.at(-1).emotion));
          word.title = annotationLabel(marks.at(-1));
        }
        word.addEventListener('click', event => handleWordClick(token.index, event));
        word.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleWordClick(token.index, event); }
        });
        row.appendChild(word);
        if (wordIndex < line.words.length - 1) row.append(' ');
      });
      const lineMarks = state.annotations.filter(mark => {
        const first = line.words[0]?.index, last = line.words.at(-1)?.index;
        return first !== undefined && mark.start <= last && mark.end >= first;
      });
      if (lineMarks.length) {
        const cues = document.createElement('div'); cues.className = 'line-notes';
        lineMarks.forEach(mark => {
          const cue = document.createElement('button'); cue.className = 'cue'; cue.style.setProperty('--cue-color', colorFor(mark.emotion));
          const main = [mark.emotion, mark.dynamic !== 'Natural' ? mark.dynamic : '', mark.action !== 'Ninguno' ? mark.action : ''].filter(Boolean).join(' · ') || 'Nota';
          cue.innerHTML = `<strong>${escapeHtml(main)}</strong>${mark.note ? ` <em>— ${escapeHtml(mark.note)}</em>` : ''}`;
          cue.title = `Editar: ${phrase(mark.start, mark.end)}`;
          cue.addEventListener('click', () => openAnnotation(mark));
          cues.appendChild(cue);
        });
        row.appendChild(cues);
      }
      if (line.words.length) {
        const sync = document.createElement('button');
        const time = state.timestamps[line.lineIndex];
        sync.className = `line-sync${Number.isFinite(time) ? ' synced' : ''}`;
        sync.textContent = Number.isFinite(time) ? `✓ ${formatTime(time)}` : 'Marcar aquí';
        sync.title = Number.isFinite(time) ? 'Actualizar marca al tiempo actual' : 'Sincronizar esta línea con el audio';
        sync.addEventListener('click', event => markLineTime(line.lineIndex, event));
        row.appendChild(sync);
      }
      score.appendChild(row);
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function handleWordClick(index, event) {
    if (window.getSelection()?.toString().trim()) return;
    if (mobileSelecting) {
      if (mobileStart === null) {
        mobileStart = index; anchor = index;
        selection = { start: index, end: index };
        $('openNote').disabled = true;
        $('mobileSelectionGuide').querySelector('.selection-step').textContent = '2';
        $('mobileSelectionText').textContent = 'Ahora toca la última palabra de la frase';
        updateSelectionControls(); renderScore();
      } else {
        setSelection(mobileStart, index);
        mobileSelecting = false; mobileStart = null;
        document.body.classList.remove('mobile-range-selecting');
        $('mobileSelectionGuide').hidden = true;
        updateSelectionControls();
        showToast('Frase seleccionada. Ya puedes añadir la indicación.');
      }
      return;
    }
    if (event.shiftKey && anchor !== null) {
      setSelection(anchor, index);
      return;
    }
    const mark = [...state.annotations].reverse().find(item => item.start <= index && item.end >= index);
    if (mark) { openAnnotation(mark); return; }
    anchor = index;
    setSelection(index, index);
  }

  function setSelection(a, b) {
    selection = { start: Math.min(a, b), end: Math.max(a, b) };
    $('openNote').disabled = false;
    $('openNote').textContent = `+ Indicar “${phrase(selection.start, selection.end).slice(0, 24)}${phrase(selection.start, selection.end).length > 24 ? '…' : ''}”`;
    updateSelectionControls();
    renderScore();
  }

  function clearSelection(render = true) {
    selection = null; anchor = null; mobileSelecting = false; mobileStart = null;
    document.body.classList.remove('mobile-range-selecting');
    $('openNote').disabled = true;
    $('openNote').textContent = '+ Añadir indicación';
    $('mobileSelectionGuide').hidden = true;
    updateSelectionControls();
    window.getSelection()?.removeAllRanges();
    if (render) renderScore();
  }

  function isMobileLayout() { return window.matchMedia('(max-width: 700px)').matches; }

  function updateSelectionControls() {
    if (!isMobileLayout()) { $('clearSelection').textContent = 'Limpiar selección'; return; }
    if (mobileSelecting) $('clearSelection').textContent = 'Cancelar selección';
    else if (selection) $('clearSelection').textContent = 'Cambiar selección';
    else $('clearSelection').textContent = 'Seleccionar frase';
  }

  function beginMobileSelection() {
    selection = null; anchor = null; mobileSelecting = true; mobileStart = null;
    document.body.classList.add('mobile-range-selecting');
    $('openNote').disabled = true; $('openNote').textContent = '+ Añadir indicación';
    $('mobileSelectionGuide').hidden = false;
    $('mobileSelectionGuide').querySelector('.selection-step').textContent = '1';
    $('mobileSelectionText').textContent = 'Toca la primera palabra de la frase';
    window.getSelection()?.removeAllRanges();
    updateSelectionControls(); renderScore();
  }

  function handleSelectionButton() {
    if (!isMobileLayout()) { clearSelection(); return; }
    if (mobileSelecting) clearSelection(); else beginMobileSelection();
  }

  function captureNativeSelection() {
    const native = window.getSelection();
    if (!native || native.isCollapsed || !native.toString().trim()) return;
    const elementFor = node => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest?.('.word');
    const startElement = elementFor(native.anchorNode), endElement = elementFor(native.focusNode);
    if (!startElement || !endElement || !$('lyricsScore').contains(startElement) || !$('lyricsScore').contains(endElement)) return;
    anchor = Number(startElement.dataset.index);
    setSelection(anchor, Number(endElement.dataset.index));
  }

  function renderChoices(containerId, options, key, withColor = false) {
    const container = $(containerId); container.replaceChildren();
    options.forEach((option, index) => {
      const value = Array.isArray(option) ? option[0] : option;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = value;
      if (withColor) button.style.setProperty('--chip-color', option[1]);
      button.classList.toggle('selected', noteDraft[key] === value);
      button.addEventListener('click', () => {
        noteDraft[key] = noteDraft[key] === value && key === 'emotion' ? '' : value;
        renderChoices(containerId, options, key, withColor);
      });
      container.appendChild(button);
    });
  }

  function openAnnotation(mark = null) {
    if (!mark && !selection) return;
    editingId = mark?.id || null;
    if (mark) selection = { start: mark.start, end: mark.end };
    noteDraft = { emotion: mark?.emotion || '', dynamic: mark?.dynamic || 'Natural', action: mark?.action || 'Ninguno' };
    $('noteText').value = mark?.note || '';
    $('selectedPhrase').textContent = phrase(selection.start, selection.end);
    $('noteTitle').textContent = mark ? 'Ajusta tu indicación' : '¿Cómo quieres cantarlo?';
    $('deleteNote').hidden = !mark;
    renderChoices('emotionChoices', emotions, 'emotion', true);
    renderChoices('dynamicChoices', dynamics, 'dynamic');
    renderChoices('actionChoices', actions, 'action');
    $('noteBackdrop').hidden = false;
    setTimeout(() => $('noteText').focus(), 50);
  }

  function closeAnnotation() { $('noteBackdrop').hidden = true; editingId = null; }

  function saveAnnotation() {
    if (!selection) return;
    const mark = { id: editingId || `note-${Date.now()}`, ...selection, ...noteDraft, note: $('noteText').value.trim() };
    state.annotations = state.annotations.filter(item => item.id !== editingId && (item.end < mark.start || item.start > mark.end));
    state.annotations.push(mark);
    state.annotations.sort((a, b) => a.start - b.start);
    closeAnnotation(); clearSelection(); persist(); showToast('Indicación guardada');
  }

  function deleteAnnotation() {
    state.annotations = state.annotations.filter(item => item.id !== editingId);
    closeAnnotation(); clearSelection(); persist(); showToast('Indicación eliminada');
  }

  function markLineTime(lineIndex, event) {
    if (!audioUrl) { showToast('Primero elige una pista de karaoke'); return; }
    if (event.shiftKey && Number.isFinite(state.timestamps[lineIndex])) {
      state.timestamps[lineIndex] = null; renderScore(); persist(); updateSyncSummary(); return;
    }
    state.timestamps[lineIndex] = Number($('audioPlayer').currentTime.toFixed(2));
    renderScore(); persist(); updateSyncSummary(); showToast(`Línea marcada en ${formatTime(state.timestamps[lineIndex])}`);
  }

  function updateSyncSummary() {
    const marked = state.timestamps.filter(Number.isFinite).length;
    $('syncSummary').textContent = audioUrl && marked ? `${marked} ${marked === 1 ? 'línea sincronizada' : 'líneas sincronizadas'}` : `Avance a ${state.bpm} BPM`;
  }

  function loadAudio(file) {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(file); audioFileName = file.name;
    $('audioPlayer').src = audioUrl; $('audioName').textContent = file.name;
    $('audioEmpty').hidden = true; $('audioLoaded').hidden = false;
    updateSyncSummary(); showToast('Pista cargada. Ahora puedes marcar las líneas.');
  }

  function removeAudio() {
    $('audioPlayer').pause();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = null; audioFileName = ''; $('audioPlayer').removeAttribute('src');
    $('audioLoaded').hidden = true; $('audioEmpty').hidden = false; updateSyncSummary();
  }

  function meterBeats() { return Number(state.meter.split('/')[0]) || 4; }

  function scheduleMetronomeClick(time, accented) {
    const context = metronome.context;
    if (!context || !state.metronomeEnabled || state.metronomeVolume <= 0) return;
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.frequency.value = accented ? 1320 : 880;
    gain.gain.setValueAtTime(Math.max(0.0001, state.metronomeVolume * (accented ? 0.32 : 0.2)), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + (accented ? 0.055 : 0.035));
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(time); oscillator.stop(time + 0.06);
  }

  function runMetronomeScheduler() {
    if (!metronome.context) return;
    while (metronome.nextTime < metronome.context.currentTime + 0.12) {
      scheduleMetronomeClick(metronome.nextTime, metronome.beat === 0);
      metronome.nextTime += 60 / state.bpm;
      metronome.beat = (metronome.beat + 1) % meterBeats();
    }
  }

  function startMetronome() {
    stopMetronome();
    if (!state.metronomeEnabled) { updateMetronomeButton(); return; }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) { showToast('Este navegador no permite reproducir el metrónomo'); return; }
    metronome.context ||= new AudioContextClass();
    metronome.context.resume().catch(() => {});
    metronome.beat = 0; metronome.nextTime = metronome.context.currentTime + 0.04;
    runMetronomeScheduler(); metronome.timer = setInterval(runMetronomeScheduler, 25);
    updateMetronomeButton();
  }

  function stopMetronome() {
    clearInterval(metronome.timer); metronome.timer = 0; updateMetronomeButton();
  }

  function restartMetronomeIfPlaying() {
    if (rehearsal.playing || (audioUrl && !$('audioPlayer').paused)) startMetronome();
  }

  function updateMetronomeButton() {
    $('rehearsalSettings').classList.toggle('metronome-on', state.metronomeEnabled);
    $('rehearsalSettings').title = state.metronomeEnabled ? `Metrónomo activo · ${state.bpm} BPM · ${state.meter}` : 'Metrónomo apagado';
  }

  function syncMetronomeControls() {
    $('bpmInput').value = state.bpm; $('meterInput').value = state.meter;
    $('metronomeEnabled').checked = state.metronomeEnabled;
    $('metronomeVolume').value = Math.round(state.metronomeVolume * 100);
    $('metronomeVolumeValue').textContent = `${Math.round(state.metronomeVolume * 100)}%`;
    $('liveBpm').value = state.bpm; $('liveMeter').value = state.meter;
    $('liveMetronomeEnabled').checked = state.metronomeEnabled;
    $('liveVolume').value = Math.round(state.metronomeVolume * 100);
    $('liveVolumeValue').textContent = `${Math.round(state.metronomeVolume * 100)}%`;
    updateMetronomeButton(); updateSyncSummary();
  }

  function setBpm(value) {
    state.bpm = clamp(Number(value) || 76, 40, 240);
    syncMetronomeControls(); restartMetronomeIfPlaying(); persist();
    if (!document.querySelector('[data-panel="rehearse"]').hidden) $('rehearsalMeta').textContent = `${state.bpm} BPM · ${state.meter}${audioUrl ? ` · Siguiendo ${audioFileName}` : ` · ${state.beatsPerLine} pulsos por línea`}`;
  }

  function setMeter(value) {
    state.meter = ['2/4', '3/4', '4/4', '6/8'].includes(value) ? value : '4/4';
    syncMetronomeControls(); restartMetronomeIfPlaying(); persist();
    if (!document.querySelector('[data-panel="rehearse"]').hidden) $('rehearsalMeta').textContent = `${state.bpm} BPM · ${state.meter}${audioUrl ? ` · Siguiendo ${audioFileName}` : ` · ${state.beatsPerLine} pulsos por línea`}`;
  }

  function setMetronomeEnabled(enabled) {
    state.metronomeEnabled = Boolean(enabled); syncMetronomeControls();
    if (state.metronomeEnabled) restartMetronomeIfPlaying(); else stopMetronome();
    persist();
  }

  function setMetronomeVolume(value) {
    state.metronomeVolume = clamp(Number(value) / 100, 0, 1); syncMetronomeControls(); persist();
  }

  function openMetronomeSettings() { syncMetronomeControls(); $('metronomeBackdrop').hidden = false; }
  function closeMetronomeSettings() { $('metronomeBackdrop').hidden = true; }

  function nonEmptyLines() { return lines.filter(line => line.words.length).map(line => line.lineIndex); }
  function lineDuration() { return state.beatsPerLine * 60 / state.bpm; }

  function enterRehearsal() {
    if (!tokens.length) { showToast('Escribe una letra antes de ensayar'); setMode('write'); return; }
    document.querySelectorAll('.mode-panel').forEach(panel => { panel.hidden = panel.dataset.panel !== 'rehearse'; });
    document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === 'rehearse'));
    rehearsal.line = nonEmptyLines()[0] ?? 0; rehearsal.elapsed = 0;
    $('rehearsalTitle').textContent = state.title;
    const synced = audioUrl && state.timestamps.filter(Number.isFinite).length > 0;
    $('rehearsalMeta').textContent = synced ? `${state.bpm} BPM · ${state.meter} · Siguiendo ${audioFileName}` : `${state.bpm} BPM · ${state.meter} · ${state.beatsPerLine} pulsos por línea`;
    renderTeleprompter(); updateTransport();
    setTimeout(() => focusTeleLine(rehearsal.line, false), 40);
  }

  function renderTeleprompter() {
    const tele = $('teleprompter'); tele.replaceChildren();
    lines.forEach(line => {
      if (!line.words.length) return;
      const block = document.createElement('div'); block.className = 'tele-line'; block.dataset.line = line.lineIndex;
      const text = document.createElement('div'); text.textContent = line.raw; block.appendChild(text);
      const first = line.words[0].index, last = line.words.at(-1).index;
      const marks = state.annotations.filter(mark => mark.start <= last && mark.end >= first);
      if (marks.length) {
        const cues = document.createElement('div'); cues.className = 'tele-cues';
        marks.forEach(mark => { const cue = document.createElement('span'); cue.textContent = annotationLabel(mark); cues.appendChild(cue); });
        block.appendChild(cues);
      }
      tele.appendChild(block);
    });
    updateTeleClasses();
  }

  function updateTeleClasses() {
    const playable = nonEmptyLines(), currentPosition = playable.indexOf(rehearsal.line);
    document.querySelectorAll('.tele-line').forEach(block => {
      const position = playable.indexOf(Number(block.dataset.line));
      block.classList.toggle('active', position === currentPosition);
      block.classList.toggle('near', position === currentPosition + 1);
      block.classList.toggle('past', position < currentPosition);
    });
  }

  function focusTeleLine(lineIndex, smooth = true) {
    rehearsal.line = lineIndex; updateTeleClasses();
    document.querySelector(`.tele-line[data-line="${lineIndex}"]`)?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  }

  function moveLine(direction) {
    const playable = nonEmptyLines();
    const position = clamp(playable.indexOf(rehearsal.line) + direction, 0, playable.length - 1);
    focusTeleLine(playable[position]);
    if (audioUrl && Number.isFinite(state.timestamps[playable[position]])) $('audioPlayer').currentTime = state.timestamps[playable[position]];
    else rehearsal.elapsed = position * lineDuration();
    updateTransport();
  }

  function toggleRehearsal() {
    if (rehearsal.playing) { pauseRehearsal(); return; }
    startCountIn();
  }

  function startCountIn() {
    const syncedAudio = audioUrl && state.timestamps.filter(Number.isFinite).length;
    if (syncedAudio && $('audioPlayer').currentTime > 0) { playRehearsal(); return; }
    let count = meterBeats();
    startMetronome();
    $('countIn').hidden = false; $('countIn').querySelector('strong').textContent = count;
    const beatMs = 60000 / state.bpm;
    clearInterval(rehearsal.countTimer);
    rehearsal.countTimer = setInterval(() => {
      count -= 1;
      if (count <= 0) { clearInterval(rehearsal.countTimer); $('countIn').hidden = true; playRehearsal(); }
      else $('countIn').querySelector('strong').textContent = count;
    }, beatMs);
  }

  function playRehearsal() {
    rehearsal.playing = true; rehearsal.startedAt = performance.now() - rehearsal.elapsed * 1000;
    if (audioUrl) $('audioPlayer').play().catch(() => showToast('Pulsa play nuevamente para iniciar el audio'));
    startMetronome();
    $('playPause').textContent = 'Ⅱ'; $('playPause').ariaLabel = 'Pausar ensayo';
    cancelAnimationFrame(rehearsal.raf); rehearsal.raf = requestAnimationFrame(tick);
  }

  function pauseRehearsal() {
    rehearsal.playing = false; cancelAnimationFrame(rehearsal.raf); $('audioPlayer').pause(); stopMetronome();
    $('playPause').textContent = '▶'; $('playPause').ariaLabel = 'Continuar ensayo';
  }

  function stopRehearsal() {
    pauseRehearsal(); clearInterval(rehearsal.countTimer); $('countIn').hidden = true;
  }

  function tick(now) {
    if (!rehearsal.playing) return;
    const playable = nonEmptyLines();
    if (audioUrl && !$('audioPlayer').paused) {
      rehearsal.elapsed = $('audioPlayer').currentTime;
      const timed = playable.filter(index => Number.isFinite(state.timestamps[index]) && state.timestamps[index] <= rehearsal.elapsed);
      if (timed.length) focusTeleLine(timed.at(-1));
      if ($('audioPlayer').ended) { pauseRehearsal(); return; }
    } else {
      rehearsal.elapsed = (now - rehearsal.startedAt) / 1000;
      const position = Math.min(Math.floor(rehearsal.elapsed / lineDuration()), playable.length - 1);
      focusTeleLine(playable[position]);
      if (position === playable.length - 1 && rehearsal.elapsed >= playable.length * lineDuration()) { pauseRehearsal(); }
    }
    updateTransport(); rehearsal.raf = requestAnimationFrame(tick);
  }

  function totalRehearsalTime() {
    return audioUrl && Number.isFinite($('audioPlayer').duration) ? $('audioPlayer').duration : nonEmptyLines().length * lineDuration();
  }

  function updateTransport() {
    const total = totalRehearsalTime();
    $('currentTime').textContent = formatTime(rehearsal.elapsed); $('totalTime').textContent = formatTime(total);
    $('progressFill').style.width = `${total ? clamp(rehearsal.elapsed / total * 100, 0, 100) : 0}%`;
  }

  function renderLibrary() {
    const list = $('songList'), songs = getLibrary().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); list.replaceChildren();
    if (!songs.length) { const empty = document.createElement('div'); empty.className = 'empty-list'; empty.textContent = 'Tus canciones aparecerán aquí.'; list.appendChild(empty); return; }
    songs.forEach(song => {
      const item = document.createElement('div'); item.className = 'song-item';
      const open = document.createElement('button');
      const marks = song.annotations?.length || song.marks?.length || 0;
      open.innerHTML = `<strong>${escapeHtml(song.title || 'Sin título')}</strong><small>${marks} ${marks === 1 ? 'indicación' : 'indicaciones'} · ${song.bpm || 76} BPM${song.id === state.id ? ' · Abierta' : ''}</small>`;
      open.addEventListener('click', () => loadSong(song));
      const remove = document.createElement('button'); remove.className = 'song-delete'; remove.textContent = 'Eliminar';
      remove.addEventListener('click', () => deleteSong(song.id)); item.append(open, remove); list.appendChild(item);
    });
  }

  function loadSong(raw) {
    persist(true); state = sanitizeSong(raw); updateEditorFromState(); $('libraryBackdrop').hidden = true; setMode('prepare'); showToast('Canción abierta');
  }

  function deleteSong(id) {
    const song = getLibrary().find(item => item.id === id);
    if (!song || !confirm(`¿Eliminar “${song.title}”? Esta acción no se puede deshacer.`)) return;
    writeLibrary(getLibrary().filter(item => item.id !== id));
    if (id === state.id) createNewSong(); else renderLibrary();
  }

  function createNewSong() {
    state = { id: `song-${Date.now()}`, title: 'Nueva canción', lyrics: '', bpm: 76, meter: '4/4', metronomeEnabled: true, metronomeVolume: 0.55, beatsPerLine: 4, annotations: [], timestamps: [], updatedAt: Date.now() };
    removeAudio(); updateEditorFromState(); persist(true); $('libraryBackdrop').hidden = true; setMode('write'); $('songTitle').select();
  }

  function exportCurrent() {
    const blob = new Blob([JSON.stringify({ ...state, format: 'vocal-emotion-studio', version: 2 }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `${state.title.replace(/[^a-z0-9áéíóúñ]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'cancion'}.vocal.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); showToast('Copia descargada');
  }

  async function importSong(file) {
    try {
      const raw = JSON.parse(await file.text());
      if (typeof raw.lyrics !== 'string') throw new Error('El archivo no contiene una letra');
      raw.id = `song-${Date.now()}`; state = sanitizeSong(raw); updateEditorFromState(); persist(true);
      $('libraryBackdrop').hidden = true; setMode('prepare'); showToast('Canción importada');
    } catch (error) { showToast(`No pude importar: ${error.message}`); }
  }

  function initialize() {
    const songs = getLibrary();
    if (!songs.length) {
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]');
        if (Array.isArray(legacy) && legacy.length) state = sanitizeSong(legacy[0]);
      } catch { /* Start with the demo song. */ }
    } else state = sanitizeSong(songs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]);
    updateEditorFromState(); persist(true); buildEvents();
  }

  function buildEvents() {
    document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
    $('homeButton').addEventListener('click', () => setMode('prepare'));
    $('lyricsInput').addEventListener('input', updateCount);
    $('applyLyrics').addEventListener('click', () => {
      const newLyrics = $('lyricsInput').value, changed = newLyrics !== state.lyrics;
      if (changed && (state.annotations.length || state.timestamps.some(Number.isFinite)) && !confirm('La letra cambió. ¿Aplicarla y borrar las indicaciones y marcas de tiempo para que no queden desfasadas?')) return;
      state.title = $('songTitle').value.trim() || 'Sin título';
      if (changed) { state.lyrics = newLyrics; state.annotations = []; state.timestamps = []; }
      parseLyrics(state.lyrics); $('displayTitle').textContent = state.title; clearSelection(false); renderScore(); persist(); setMode('prepare');
    });
    $('lyricsScore').addEventListener('pointerup', () => setTimeout(captureNativeSelection, 20));
    $('openNote').addEventListener('click', () => openAnnotation()); $('clearSelection').addEventListener('click', handleSelectionButton);
    $('cancelMobileSelection').addEventListener('click', () => clearSelection());
    $('dismissTip').addEventListener('click', () => { $('selectionTip').hidden = true; localStorage.setItem('ves-tip-dismissed', '1'); });
    if (localStorage.getItem('ves-tip-dismissed')) $('selectionTip').hidden = true;
    $('closeNote').addEventListener('click', closeAnnotation); $('cancelNote').addEventListener('click', closeAnnotation); $('saveNote').addEventListener('click', saveAnnotation); $('deleteNote').addEventListener('click', deleteAnnotation);
    $('noteBackdrop').addEventListener('click', event => { if (event.target === $('noteBackdrop')) closeAnnotation(); });
    document.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => setBpm(Number($('bpmInput').value) + Number(button.dataset.step))));
    $('bpmInput').addEventListener('change', () => setBpm($('bpmInput').value));
    $('meterInput').addEventListener('change', () => setMeter($('meterInput').value));
    $('metronomeEnabled').addEventListener('change', () => setMetronomeEnabled($('metronomeEnabled').checked));
    $('metronomeVolume').addEventListener('input', () => setMetronomeVolume($('metronomeVolume').value));
    $('beatsInput').addEventListener('change', () => { state.beatsPerLine = Number($('beatsInput').value); persist(); });
    $('chooseAudio').addEventListener('click', () => $('audioFile').click()); $('audioFile').addEventListener('change', event => { const file = event.target.files?.[0]; if (file) loadAudio(file); event.target.value = ''; }); $('removeAudio').addEventListener('click', removeAudio);
    $('audioPlayer').addEventListener('loadedmetadata', () => { $('audioDuration').textContent = `${formatTime($('audioPlayer').duration)} · Lista para sincronizar`; updateTransport(); });
    $('audioPlayer').addEventListener('play', () => { if (!rehearsal.playing) startMetronome(); });
    $('audioPlayer').addEventListener('pause', () => { if (!rehearsal.playing) stopMetronome(); });
    $('startRehearsal').addEventListener('click', enterRehearsal); $('exitRehearsal').addEventListener('click', () => setMode('prepare')); $('rehearsalSettings').addEventListener('click', openMetronomeSettings);
    $('closeMetronome').addEventListener('click', closeMetronomeSettings); $('metronomeBackdrop').addEventListener('click', event => { if (event.target === $('metronomeBackdrop')) closeMetronomeSettings(); });
    $('liveBpmDown').addEventListener('click', () => setBpm(state.bpm - 1)); $('liveBpmUp').addEventListener('click', () => setBpm(state.bpm + 1));
    $('liveBpm').addEventListener('change', () => setBpm($('liveBpm').value)); $('liveMeter').addEventListener('change', () => setMeter($('liveMeter').value));
    $('liveMetronomeEnabled').addEventListener('change', () => setMetronomeEnabled($('liveMetronomeEnabled').checked)); $('liveVolume').addEventListener('input', () => setMetronomeVolume($('liveVolume').value));
    $('playPause').addEventListener('click', toggleRehearsal); $('previousLine').addEventListener('click', () => moveLine(-1)); $('nextLine').addEventListener('click', () => moveLine(1));
    $('rehearsalFullscreen').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => showToast('Pantalla completa no disponible')));
    $('libraryButton').addEventListener('click', () => { renderLibrary(); $('libraryBackdrop').hidden = false; }); $('closeLibrary').addEventListener('click', () => $('libraryBackdrop').hidden = true); $('libraryBackdrop').addEventListener('click', event => { if (event.target === $('libraryBackdrop')) $('libraryBackdrop').hidden = true; });
    $('newSong').addEventListener('click', createNewSong); $('exportSong').addEventListener('click', exportCurrent); $('importSong').addEventListener('click', () => $('importFile').click()); $('importFile').addEventListener('change', event => { const file = event.target.files?.[0]; if (file) importSong(file); event.target.value = ''; });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { if (!$('noteBackdrop').hidden) closeAnnotation(); else if (!$('libraryBackdrop').hidden) $('libraryBackdrop').hidden = true; else if (!$('metronomeBackdrop').hidden) closeMetronomeSettings(); }
      const rehearsing = !document.querySelector('[data-panel="rehearse"]').hidden;
      if (rehearsing && event.code === 'Space' && !['INPUT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName)) { event.preventDefault(); toggleRehearsal(); }
      if (rehearsing && event.key === 'ArrowUp') { event.preventDefault(); moveLine(-1); }
      if (rehearsing && event.key === 'ArrowDown') { event.preventDefault(); moveLine(1); }
    });
    window.addEventListener('resize', updateSelectionControls);
    updateSelectionControls();
  }

  initialize();
})();
