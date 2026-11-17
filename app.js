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
    semitones: 0,
    beatsPerLine: 4,
    annotations: [],
    downbeatTime: null,
    timestamps: [],
    updatedAt: Date.now()
  };
  let lines = [], tokens = [], selection = null, anchor = null, editingId = null;
  let mobileSelecting = false, mobileStart = null;
  let noteDraft = { emotion: '', dynamic: 'Natural', action: 'Ninguno' };
  let audioUrl = null, audioFileName = '', audioFileData = null, syncPosition = 0, tempoAnalysisId = 0, prepareActiveLine = null;
  let rehearsal = { playing: false, line: 0, elapsed: 0, startedAt: 0, raf: 0, countTimer: 0 };
  let metronome = { context: null, timer: 0, nextTime: 0, beat: 0 };
  let pitchEngine = { source: null, effect: null, ready: false, failed: false };
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
      semitones: clamp(Math.round(Number(raw.semitones) || 0), -6, 6),
      beatsPerLine: [2, 4, 8, 16].includes(Number(raw.beatsPerLine)) ? Number(raw.beatsPerLine) : 4,
      annotations,
      downbeatTime: raw.downbeatTime !== null && raw.downbeatTime !== '' && Number.isFinite(Number(raw.downbeatTime)) ? Number(raw.downbeatTime) : null,
      timestamps: Array.isArray(raw.timestamps) ? raw.timestamps.map(value => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null) : [],
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
  function formatMarkerTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const minutes = Math.floor(seconds / 60), wholeSeconds = Math.floor(seconds % 60), tenths = Math.floor((seconds % 1) * 10);
    return `${minutes}:${String(wholeSeconds).padStart(2, '0')}.${tenths}`;
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
    syncPitchControls();
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
    document.body.classList.toggle('audio-dock-visible', mode === 'prepare' && Boolean(audioUrl));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderScore() {
    const score = $('lyricsScore');
    score.replaceChildren();
    lines.forEach(line => {
      const row = document.createElement('div');
      row.className = `score-line${line.words.length ? '' : ' blank'}`;
      row.dataset.lineIndex = line.lineIndex;
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
          word.title = marks.length === 1 ? annotationLabel(marks[0]) : `${marks.length} indicaciones · selecciónala para añadir otra`;
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
        const actions = document.createElement('div');
        actions.className = 'line-sync-actions';
        const sync = document.createElement('button');
        const time = state.timestamps[line.lineIndex];
        const isFirstLine = line.lineIndex === nonEmptyLines()[0];
        sync.className = `line-sync${Number.isFinite(time) ? ' synced' : ''}`;
        sync.textContent = Number.isFinite(time) ? `${isFirstLine ? 'Inicio letra' : 'Inicio'} ${formatMarkerTime(time)}` : (isFirstLine ? 'Marcar inicio letra' : 'Marcar inicio frase');
        sync.title = Number.isFinite(time) ? 'Instante en que comienza esta frase · pulsa para modificarlo o borrarlo' : 'Elegir cuándo comienza esta frase';
        sync.addEventListener('click', event => markLineTime(line.lineIndex, event));
        actions.appendChild(sync);
        if (Number.isFinite(time)) {
          const remove = document.createElement('button');
          remove.className = 'line-sync-delete'; remove.type = 'button'; remove.textContent = '×';
          remove.title = 'Eliminar marca de tiempo'; remove.setAttribute('aria-label', `Eliminar marca de tiempo de “${line.raw}”`);
          remove.addEventListener('click', event => {
            event.stopPropagation(); state.timestamps[line.lineIndex] = null; persist(); renderScore(); updateSyncSummary(); updateSyncView(false); showToast('Marca eliminada');
          });
          actions.appendChild(remove);
        }
        row.appendChild(actions);
      }
      score.appendChild(row);
    });
    updatePreparePlaybackCursor();
  }

  function updatePreparePlaybackCursor() {
    const audio = $('audioPlayer'), playable = nonEmptyLines();
    document.querySelectorAll('.score-line.playback-active').forEach(row => row.classList.remove('playback-active'));
    document.querySelectorAll('.lyrics-score .word').forEach(word => { word.classList.remove('playback-read', 'playback-current'); word.style.removeProperty('--word-progress'); });
    if (!audioUrl || !playable.length || !Number.isFinite(audio.currentTime)) { prepareActiveLine = null; return; }

    const current = audio.currentTime, { times } = estimatedLineTimes(playable);
    let position = 0;
    for (let index = 0; index < times.length; index += 1) { if (times[index] <= current) position = index; else break; }
    const lineIndex = playable[position], start = times[position];
    const end = times[position + 1] ?? (Number.isFinite(audio.duration) ? audio.duration : start + lineDuration());

    const row = document.querySelector(`.score-line[data-line-index="${lineIndex}"]`);
    if (!row) return;
    const progress = end > start ? clamp((current - start) / (end - start), 0, 1) : 1;
    row.classList.add('playback-active'); applyWordProgress(row, progress, '.word');
    if (!audio.paused && prepareActiveLine !== lineIndex && document.querySelector('.lyrics-accordion')?.open) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    prepareActiveLine = lineIndex;
  }

  function applyWordProgress(container, progress, selector) {
    const words = [...container.querySelectorAll(selector)];
    if (!words.length) return;
    const lengths = words.map((word, index) => Math.max(1, word.textContent.length) + (index < words.length - 1 ? 1 : 0));
    const target = clamp(progress, 0, 1) * lengths.reduce((sum, length) => sum + length, 0);
    let consumed = 0;
    words.forEach((word, index) => {
      const length = lengths[index];
      word.classList.remove('playback-read', 'playback-current'); word.style.removeProperty('--word-progress');
      if (target >= consumed + length) word.classList.add('playback-read');
      else if (target >= consumed) {
        word.classList.add('playback-current');
        word.style.setProperty('--word-progress', `${clamp((target - consumed) / length * 100, 0, 100).toFixed(2)}%`);
      }
      consumed += length;
    });
  }

  function estimatedLineTimes(playable = nonEmptyLines()) {
    const times = playable.map(lineIndex => Number.isFinite(state.timestamps[lineIndex]) ? state.timestamps[lineIndex] : null);
    const anchors = times.map((time, position) => ({ position, time })).filter(anchor => Number.isFinite(anchor.time));
    if (!anchors.length) return { times: playable.map((_, position) => position * lineDuration()), step: lineDuration(), anchors };

    const learnedSteps = [];
    for (let index = 1; index < anchors.length; index += 1) {
      const distance = anchors[index].position - anchors[index - 1].position;
      const duration = anchors[index].time - anchors[index - 1].time;
      if (distance > 0 && duration > 0) learnedSteps.push(duration / distance);
    }
    learnedSteps.sort((a, b) => a - b);
    const step = learnedSteps.length ? learnedSteps[Math.floor(learnedSteps.length / 2)] : lineDuration();
    for (let anchorIndex = 1; anchorIndex < anchors.length; anchorIndex += 1) {
      const previous = anchors[anchorIndex - 1], next = anchors[anchorIndex];
      const segmentStep = (next.time - previous.time) / (next.position - previous.position);
      for (let position = previous.position + 1; position < next.position; position += 1) times[position] = previous.time + segmentStep * (position - previous.position);
    }
    const first = anchors[0], last = anchors[anchors.length - 1];
    for (let position = first.position - 1; position >= 0; position -= 1) times[position] = Math.max(0, first.time - step * (first.position - position));
    for (let position = last.position + 1; position < times.length; position += 1) times[position] = last.time + step * (position - last.position);
    return { times, step, anchors };
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
        $('mobileSelectionText').textContent = 'Toca la misma palabra o el final de la frase';
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
    anchor = index;
    setSelection(index, index);
  }

  function setSelection(a, b) {
    selection = { start: Math.min(a, b), end: Math.max(a, b) };
    $('openNote').disabled = false;
    $('openNote').textContent = `Indicar “${phrase(selection.start, selection.end).slice(0, 24)}${phrase(selection.start, selection.end).length > 24 ? '…' : ''}”`;
    updateSelectionControls();
    renderScore();
  }

  function clearSelection(render = true) {
    selection = null; anchor = null; mobileSelecting = false; mobileStart = null;
    document.body.classList.remove('mobile-range-selecting');
    $('openNote').disabled = true;
    $('openNote').textContent = 'Añadir indicación';
    $('mobileSelectionGuide').hidden = true;
    updateSelectionControls();
    window.getSelection()?.removeAllRanges();
    if (render) renderScore();
  }

  function isMobileLayout() { return window.matchMedia('(max-width: 700px)').matches; }

  function updateSelectionControls() {
    $('clearSelection').disabled = !selection && !mobileSelecting;
    if (!isMobileLayout()) { $('clearSelection').textContent = 'Limpiar selección'; return; }
    if (mobileSelecting) $('clearSelection').textContent = 'Cancelar selección';
    else if (selection) $('clearSelection').textContent = 'Cambiar selección';
    else $('clearSelection').textContent = 'Seleccionar palabras';
  }

  function beginMobileSelection() {
    selection = null; anchor = null; mobileSelecting = true; mobileStart = null;
    document.body.classList.add('mobile-range-selecting');
    $('openNote').disabled = true; $('openNote').textContent = '+ Añadir indicación';
    $('mobileSelectionGuide').hidden = false;
    $('mobileSelectionGuide').querySelector('.selection-step').textContent = '1';
    $('mobileSelectionText').textContent = 'Toca una palabra para comenzar';
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
    state.annotations = state.annotations.filter(item => item.id !== editingId);
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
    openSyncStudio(lineIndex);
  }

  function updateSyncSummary() {
    const playable = nonEmptyLines(), marked = playable.filter(index => Number.isFinite(state.timestamps[index])).length;
    $('syncSummary').textContent = audioUrl && marked ? `${marked} ${marked === 1 ? 'línea sincronizada' : 'líneas sincronizadas'}` : `Avance a ${state.bpm} BPM`;
    $('downbeatStatus').textContent = Number.isFinite(state.downbeatTime) ? `Pulso 1: ${formatMarkerTime(state.downbeatTime)} · ancla del metrónomo` : 'Pulso 1: todavía sin marcar';
    $('resetSyncMarks').disabled = marked === 0 && !Number.isFinite(state.downbeatTime);
    $('completeSyncMarks').disabled = marked === 0 || marked === playable.length;
  }

  function openSyncStudio(targetLineIndex = null) {
    if (!audioUrl) { showToast('Primero carga una pista'); return; }
    const playable = nonEmptyLines();
    if (!playable.length) { showToast('La canción todavía no tiene letra'); return; }
    const requestedPosition = targetLineIndex === null ? null : playable.indexOf(targetLineIndex);
    const firstUnmarked = playable.findIndex(index => !Number.isFinite(state.timestamps[index]));
    syncPosition = requestedPosition !== null && requestedPosition >= 0 ? requestedPosition : (!Number.isFinite(state.downbeatTime) ? -1 : (firstUnmarked >= 0 ? firstUnmarked : 0));
    $('syncBackdrop').hidden = false; updateSyncView(requestedPosition !== null && requestedPosition >= 0); updateSyncTransport();
  }

  function closeSyncStudio() {
    $('audioPlayer').pause(); $('syncBackdrop').hidden = true; updateSyncTransport();
  }

  function updateSyncView(seekToMark = false) {
    const playable = nonEmptyLines();
    syncPosition = clamp(syncPosition, -1, Math.max(-1, playable.length - 1));
    const isBeatStep = syncPosition === -1, lineIndex = isBeatStep ? null : playable[syncPosition], line = isBeatStep ? null : lines[lineIndex];
    const markedAt = isBeatStep ? state.downbeatTime : state.timestamps[lineIndex], totalSteps = playable.length + 1;
    $('syncProgressText').textContent = isBeatStep ? 'Ancla musical · Pulso 1' : `Frase ${syncPosition + 1} de ${playable.length}`;
    $('syncProgressFill').style.width = `${totalSteps ? (syncPosition + 2) / totalSteps * 100 : 0}%`;
    $('syncLineText').textContent = isBeatStep ? 'Primer pulso fuerte del compás' : (line?.raw || '');
    $('syncPrevious').disabled = isBeatStep; $('syncNext').disabled = syncPosition >= playable.length - 1;
    $('syncRemoveMark').hidden = !Number.isFinite(markedAt);
    $('syncMark').classList.toggle('marked', Number.isFinite(markedAt));
    const markLabel = isBeatStep ? 'primer pulso' : (syncPosition === 0 ? 'inicio letra' : 'inicio frase');
    $('syncMark').querySelector('span').textContent = `${Number.isFinite(markedAt) ? 'Actualizar' : 'Marcar'} ${markLabel}`;
    $('syncMarkHint').textContent = Number.isFinite(markedAt) ? `Marcada en ${formatMarkerTime(markedAt)} · puedes moverla o borrarla` : (isBeatStep ? 'Pulsa en el primer pulso fuerte del compás' : (syncPosition === 0 ? 'Pulsa cuando entre la primera palabra de la letra' : 'Pulsa cuando comience esta frase'));
    if (seekToMark && Number.isFinite(markedAt)) $('audioPlayer').currentTime = markedAt;
  }

  function updateSyncTransport() {
    const audio = $('audioPlayer'), duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    $('syncCurrentTime').textContent = formatMarkerTime(audio.currentTime); $('syncTotalTime').textContent = formatTime(duration);
    $('syncSeek').max = duration || 1; $('syncSeek').value = Math.min(audio.currentTime, duration || 0);
    $('syncPlayPause').classList.toggle('is-playing', !audio.paused); $('syncPlayPause').ariaLabel = audio.paused ? 'Reproducir pista' : 'Pausar pista';
  }

  function toggleSyncPlayback() {
    if ($('audioPlayer').paused) $('audioPlayer').play().catch(() => showToast('No pude iniciar el audio'));
    else $('audioPlayer').pause();
  }

  function moveSyncLine(direction) {
    syncPosition += direction; updateSyncView(true);
  }

  function nudgeSyncTime(amount) {
    const duration = Number.isFinite($('audioPlayer').duration) ? $('audioPlayer').duration : Infinity;
    $('audioPlayer').currentTime = clamp($('audioPlayer').currentTime + amount, 0, duration);
    updateSyncTransport();
  }

  function markCurrentSyncLine() {
    const playable = nonEmptyLines();
    if (syncPosition === -1) {
      state.downbeatTime = Number($('audioPlayer').currentTime.toFixed(2));
      persist(); updateSyncSummary(); updateSyncView(false); syncPosition = 0; updateSyncView(false); return;
    }
    const lineIndex = playable[syncPosition];
    if (lineIndex === undefined) return;
    state.timestamps[lineIndex] = Number($('audioPlayer').currentTime.toFixed(2));
    persist(); renderScore(); updateSyncSummary(); updateSyncView(false);
    if (syncPosition < playable.length - 1) { syncPosition += 1; updateSyncView(false); }
    else showToast('Sincronización completa');
  }

  function removeCurrentSyncMark() {
    if (syncPosition === -1) { state.downbeatTime = null; persist(); updateSyncSummary(); updateSyncView(false); return; }
    const lineIndex = nonEmptyLines()[syncPosition];
    if (lineIndex === undefined) return;
    state.timestamps[lineIndex] = null; persist(); renderScore(); updateSyncSummary(); updateSyncView(false);
  }

  function completeSyncMarks() {
    const playable = nonEmptyLines();
    const { times, step, anchors } = estimatedLineTimes(playable);
    if (!anchors.length) { showToast('Marca al menos una línea primero'); return; }
    const audioDuration = Number.isFinite($('audioPlayer').duration) ? $('audioPlayer').duration : Infinity;
    playable.forEach((lineIndex, position) => {
      if (!Number.isFinite(state.timestamps[lineIndex])) state.timestamps[lineIndex] = Number(clamp(times[position], 0, audioDuration).toFixed(2));
    });

    persist(); renderScore(); updateSyncSummary();
    showToast(`Marcas completadas usando ${step.toFixed(1)} s por línea`);
  }

  function clearAllSyncMarks() {
    if ((!state.timestamps.some(Number.isFinite) && !Number.isFinite(state.downbeatTime)) || !confirm('¿Reiniciar el primer pulso y todas las marcas de frases?')) return;
    state.downbeatTime = null; state.timestamps = []; syncPosition = -1; persist(); renderScore(); updateSyncSummary(); updateSyncView(false);
    showToast('Marcas reiniciadas');
  }

  function loadAudio(file, analyze = true) {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(file); audioFileName = file.name; audioFileData = file;
    $('audioPlayer').src = audioUrl; $('audioName').textContent = file.name; $('dockAudioName').textContent = file.name;
    $('audioEmpty').hidden = true; $('audioLoaded').hidden = false; $('audioDock').hidden = false;
    document.body.classList.add('audio-dock-visible');
    setupPitchProcessing(); syncPitchControls();
    if (analyze) { $('tempoStatus').textContent = 'Detectando tempo…'; detectTempo(file); }
    else $('tempoStatus').textContent = `Tempo guardado: ${state.bpm} BPM`;
    updateSyncSummary(); showToast('Pista cargada. Ahora puedes marcar las líneas.');
  }

  function removeAudio() {
    if (!$('syncBackdrop').hidden) closeSyncStudio();
    tempoAnalysisId += 1;
    $('audioPlayer').pause();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = null; audioFileName = ''; audioFileData = null; $('audioPlayer').removeAttribute('src');
    $('audioLoaded').hidden = true; $('audioEmpty').hidden = false; $('audioDock').hidden = true; document.body.classList.remove('audio-dock-visible'); syncPitchControls(); updateSyncSummary();
  }

  async function detectTempo(file = audioFileData) {
    if (!file) return;
    const analysisId = ++tempoAnalysisId;
    const button = $('detectTempo'); button.disabled = true; button.textContent = 'Analizando…';
    $('tempoStatus').textContent = 'Escuchando el pulso de la pista…';
    let context;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('AudioContext no disponible');
      context = new AudioContextClass();
      const analysis = (async () => context.decodeAudioData(await file.arrayBuffer()))();
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('El análisis tardó demasiado')), 15000));
      const buffer = await Promise.race([analysis, timeout]);
      if (analysisId !== tempoAnalysisId || file !== audioFileData) return;
      const bpm = estimateTempo(buffer);
      if (!bpm) throw new Error('No se encontró un pulso estable');
      setBpm(bpm);
      $('tempoStatus').textContent = `Tempo detectado: ${bpm} BPM · estimado`;
      showToast(`Tempo estimado: ${bpm} BPM`);
    } catch (error) {
      if (analysisId === tempoAnalysisId) $('tempoStatus').textContent = error.message.includes('tardó') ? 'El análisis tardó demasiado. Ajusta el BPM manualmente o intenta de nuevo.' : 'No pude detectar un pulso claro. Puedes ajustar el BPM manualmente.';
    } finally {
      context?.close?.();
      if (analysisId === tempoAnalysisId) { button.disabled = false; button.textContent = 'Detectar BPM'; }
    }
  }

  function estimateTempo(buffer) {
    const sampleRate = buffer.sampleRate, blockSize = 1024;
    const sampleCount = Math.min(buffer.length, Math.floor(sampleRate * 120));
    const blockCount = Math.floor(sampleCount / blockSize);
    if (blockCount < 20) return null;
    const energies = new Float32Array(blockCount), channels = Math.min(buffer.numberOfChannels, 2);
    for (let block = 0; block < blockCount; block++) {
      let total = 0;
      for (let channel = 0; channel < channels; channel++) {
        const data = buffer.getChannelData(channel), start = block * blockSize;
        for (let i = start; i < start + blockSize; i += 2) total += Math.abs(data[i]);
      }
      energies[block] = total / (channels * blockSize / 2);
    }
    const flux = new Float32Array(blockCount);
    for (let i = 1; i < blockCount; i++) flux[i] = Math.max(0, energies[i] - energies[i - 1]);
    const peaks = [], minimumGap = Math.max(1, Math.floor(sampleRate * 0.22 / blockSize));
    let lastPeak = -minimumGap;
    for (let i = 4; i < blockCount - 4; i++) {
      let localMean = 0;
      for (let j = i - 4; j <= i + 4; j++) localMean += flux[j];
      localMean /= 9;
      if (flux[i] > localMean * 1.45 && flux[i] >= flux[i - 1] && flux[i] > flux[i + 1] && i - lastPeak >= minimumGap) {
        peaks.push(i * blockSize / sampleRate); lastPeak = i;
      }
    }
    if (peaks.length < 6) return null;
    const scores = new Float32Array(241);
    for (let i = 0; i < peaks.length; i++) {
      for (let j = i + 1; j < Math.min(peaks.length, i + 9); j++) {
        const interval = peaks[j] - peaks[i];
        if (interval < 0.25 || interval > 2) continue;
        let bpm = 60 / interval;
        while (bpm < 60) bpm *= 2;
        while (bpm > 200) bpm /= 2;
        const rounded = Math.round(bpm);
        if (rounded >= 40 && rounded <= 240) scores[rounded] += 1 / (j - i);
      }
    }
    let bestBpm = 0, bestScore = 0;
    for (let bpm = 40; bpm <= 240; bpm++) {
      const clustered = scores[bpm] + (scores[bpm - 1] || 0) * 0.6 + (scores[bpm + 1] || 0) * 0.6;
      if (clustered > bestScore) { bestScore = clustered; bestBpm = bpm; }
    }
    return bestScore > 0 ? bestBpm : null;
  }

  function pitchDescription(value = state.semitones) {
    if (value === 0) return 'Tono original';
    const amount = Math.abs(value), direction = value > 0 ? 'arriba' : 'abajo';
    return `${amount} ${amount === 1 ? 'semitono' : 'semitonos'} ${direction}`;
  }

  function syncPitchControls() {
    if (pitchEngine.effect) pitchEngine.effect.pitch = state.semitones;
    const signed = state.semitones > 0 ? `+${state.semitones}` : String(state.semitones);
    $('pitchSlider').value = state.semitones; $('pitchValue').textContent = signed; $('pitchLabel').textContent = pitchDescription();
    $('livePitch').value = state.semitones; $('livePitchLabel').textContent = audioUrl ? pitchDescription() : 'Carga una pista para usarlo';
    for (const id of ['livePitchDown', 'livePitch', 'livePitchUp']) $(id).disabled = !audioUrl;
  }

  function setupPitchProcessing() {
    if (pitchEngine.ready || pitchEngine.failed || !window.Tone) {
      if (!window.Tone) { pitchEngine.failed = true; $('audioLoaded').dataset.pitchEngine = 'unavailable'; }
      return pitchEngine.ready;
    }
    try {
      const context = Tone.getContext();
      pitchEngine.source = context.createMediaElementSource($('audioPlayer'));
      pitchEngine.effect = new Tone.PitchShift(state.semitones).toDestination();
      pitchEngine.effect.windowSize = 0.08;
      Tone.connect(pitchEngine.source, pitchEngine.effect);
      pitchEngine.ready = true; $('audioLoaded').dataset.pitchEngine = 'ready';
      return true;
    } catch (error) {
      console.error('No se pudo iniciar el cambio de tonalidad', error);
      pitchEngine.failed = true; $('audioLoaded').dataset.pitchEngine = 'failed'; return false;
    }
  }

  function resumePitchAudio() {
    if (!pitchEngine.ready) setupPitchProcessing();
    if (window.Tone) Tone.start().catch(() => {});
  }

  function setPitch(value) {
    state.semitones = clamp(Math.round(Number(value) || 0), -6, 6);
    if (pitchEngine.effect) pitchEngine.effect.pitch = state.semitones;
    syncPitchControls(); persist();
    if (!document.querySelector('[data-panel="rehearse"]').hidden) $('rehearsalMeta').textContent = rehearsalMetaText();
    if (state.semitones !== 0 && !pitchEngine.ready) showToast('No pude activar el cambio de tono en este navegador');
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

  function firstBeatAnchor() {
    return Number.isFinite(state.downbeatTime) ? state.downbeatTime : null;
  }

  function startMetronome(alignToTrack = true) {
    stopMetronome();
    if (!state.metronomeEnabled) { updateMetronomeButton(); return; }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) { showToast('Este navegador no permite reproducir el metrónomo'); return; }
    metronome.context ||= new AudioContextClass();
    metronome.context.resume().catch(() => {});
    const audio = $('audioPlayer'), anchor = alignToTrack && audioUrl ? firstBeatAnchor() : null;
    if (Number.isFinite(anchor)) {
      const beatDuration = 60 / state.bpm, songTime = audio.currentTime;
      let beatIndex = songTime < anchor ? 0 : Math.ceil((songTime - anchor) / beatDuration - 0.0001);
      let nextSongBeat = anchor + beatIndex * beatDuration;
      if (nextSongBeat - songTime < 0.03) { beatIndex += 1; nextSongBeat += beatDuration; }
      metronome.beat = beatIndex % meterBeats();
      metronome.nextTime = metronome.context.currentTime + Math.max(0.03, nextSongBeat - songTime);
    } else {
      metronome.beat = 0; metronome.nextTime = metronome.context.currentTime + 0.04;
    }
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

  function rehearsalMetaText() {
    const pitchText = `${state.semitones > 0 ? '+' : ''}${state.semitones} ST`;
    return audioUrl ? `${state.bpm} BPM · ${state.meter} · ${pitchText} · Siguiendo ${audioFileName}` : `${state.bpm} BPM · ${state.meter} · ${state.beatsPerLine} pulsos por línea`;
  }

  function setBpm(value) {
    state.bpm = clamp(Number(value) || 76, 40, 240);
    syncMetronomeControls(); restartMetronomeIfPlaying(); persist();
    if (!document.querySelector('[data-panel="rehearse"]').hidden) $('rehearsalMeta').textContent = rehearsalMetaText();
  }

  function setMeter(value) {
    state.meter = ['2/4', '3/4', '4/4', '6/8'].includes(value) ? value : '4/4';
    syncMetronomeControls(); restartMetronomeIfPlaying(); persist();
    if (!document.querySelector('[data-panel="rehearse"]').hidden) $('rehearsalMeta').textContent = rehearsalMetaText();
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
    stopRehearsal();
    document.querySelectorAll('.mode-panel').forEach(panel => { panel.hidden = panel.dataset.panel !== 'rehearse'; });
    document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === 'rehearse'));
    document.body.classList.remove('audio-dock-visible');
    rehearsal.line = nonEmptyLines()[0] ?? 0; rehearsal.elapsed = 0;
    $('rehearsalTitle').textContent = state.title;
    const synced = audioUrl && state.timestamps.filter(Number.isFinite).length > 0;
    $('rehearsalMeta').textContent = synced ? rehearsalMetaText() : `${state.bpm} BPM · ${state.meter} · ${state.beatsPerLine} pulsos por línea`;
    renderTeleprompter(); updateTransport();
    setTimeout(() => focusTeleLine(rehearsal.line, false), 40);
  }

  function renderTeleprompter() {
    const tele = $('teleprompter'); tele.replaceChildren();
    lines.forEach(line => {
      if (!line.words.length) return;
      const block = document.createElement('div'); block.className = 'tele-line'; block.dataset.line = line.lineIndex;
      const text = document.createElement('div'); text.className = 'tele-text';
      line.words.forEach((token, index) => {
        const word = document.createElement('span'); word.className = 'tele-word'; word.textContent = token.word; text.appendChild(word);
        if (index < line.words.length - 1) text.append(' ');
      });
      block.appendChild(text);
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
    const changed = rehearsal.line !== lineIndex;
    rehearsal.line = lineIndex; updateTeleClasses();
    if (changed || !smooth) document.querySelector(`.tele-line[data-line="${lineIndex}"]`)?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  }

  function updateTeleWordProgress(progress) {
    document.querySelectorAll('.tele-word').forEach(word => { word.classList.remove('playback-read', 'playback-current'); word.style.removeProperty('--word-progress'); });
    const active = document.querySelector(`.tele-line[data-line="${rehearsal.line}"]`);
    if (active) applyWordProgress(active, progress, '.tele-word');
  }

  function moveLine(direction) {
    const playable = nonEmptyLines();
    const position = clamp(playable.indexOf(rehearsal.line) + direction, 0, playable.length - 1);
    focusTeleLine(playable[position]);
    if (audioUrl && Number.isFinite(state.timestamps[playable[position]])) $('audioPlayer').currentTime = state.timestamps[playable[position]];
    else rehearsal.elapsed = position * lineDuration();
    updateTeleWordProgress(0);
    updateTransport();
  }

  function restartSong() {
    const firstLine = nonEmptyLines()[0] ?? 0;
    const wasPlaying = rehearsal.playing;
    if (wasPlaying) cancelAnimationFrame(rehearsal.raf);
    rehearsal.elapsed = 0; rehearsal.startedAt = performance.now();
    if (audioUrl) $('audioPlayer').currentTime = 0;
    focusTeleLine(firstLine);
    updateTeleWordProgress(0);
    if (wasPlaying) { startMetronome(); rehearsal.raf = requestAnimationFrame(tick); }
    updateTransport(); showToast('Volvimos al inicio');
  }

  function toggleRehearsal() {
    if (rehearsal.playing) { pauseRehearsal(); return; }
    startCountIn();
  }

  function startCountIn() {
    const syncedAudio = audioUrl && state.timestamps.filter(Number.isFinite).length;
    if (syncedAudio && $('audioPlayer').currentTime > 0) { playRehearsal(); return; }
    let count = meterBeats();
    resumePitchAudio();
    startMetronome(false);
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
    resumePitchAudio();
    if (audioUrl) $('audioPlayer').play().catch(() => showToast('Pulsa play nuevamente para iniciar el audio'));
    startMetronome();
    $('playPause').classList.add('is-playing'); $('playPause').ariaLabel = 'Pausar ensayo';
    cancelAnimationFrame(rehearsal.raf); rehearsal.raf = requestAnimationFrame(tick);
  }

  function pauseRehearsal() {
    rehearsal.playing = false; cancelAnimationFrame(rehearsal.raf); $('audioPlayer').pause(); stopMetronome();
    $('playPause').classList.remove('is-playing'); $('playPause').ariaLabel = 'Continuar ensayo';
  }

  function stopRehearsal() {
    pauseRehearsal(); clearInterval(rehearsal.countTimer); $('countIn').hidden = true;
  }

  function tick(now) {
    if (!rehearsal.playing) return;
    const playable = nonEmptyLines();
    if (audioUrl && !$('audioPlayer').paused) {
      rehearsal.elapsed = $('audioPlayer').currentTime;
      const markedLines = playable.filter(index => Number.isFinite(state.timestamps[index]));
      if (markedLines.length) {
        const timed = markedLines.filter(index => state.timestamps[index] <= rehearsal.elapsed);
        focusTeleLine(timed.length ? timed.at(-1) : playable[0]);
      } else {
        const position = Math.min(Math.floor(rehearsal.elapsed / lineDuration()), playable.length - 1);
        focusTeleLine(playable[position]);
      }
      if ($('audioPlayer').ended) { pauseRehearsal(); return; }
    } else {
      rehearsal.elapsed = (now - rehearsal.startedAt) / 1000;
      const position = Math.min(Math.floor(rehearsal.elapsed / lineDuration()), playable.length - 1);
      focusTeleLine(playable[position]);
      if (position === playable.length - 1 && rehearsal.elapsed >= playable.length * lineDuration()) { pauseRehearsal(); }
    }
    const { times } = estimatedLineTimes(playable), position = Math.max(0, playable.indexOf(rehearsal.line));
    const start = times[position] ?? 0, end = times[position + 1] ?? totalRehearsalTime();
    updateTeleWordProgress(end > start ? (rehearsal.elapsed - start) / (end - start) : 1);
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
    state = { id: `song-${Date.now()}`, title: 'Nueva canción', lyrics: '', bpm: 76, meter: '4/4', metronomeEnabled: true, metronomeVolume: 0.55, semitones: 0, beatsPerLine: 4, annotations: [], downbeatTime: null, timestamps: [], updatedAt: Date.now() };
    removeAudio(); updateEditorFromState(); persist(true); $('libraryBackdrop').hidden = true; setMode('write'); $('songTitle').select();
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error || new Error('No se pudo leer la pista')); reader.readAsDataURL(file); });
  }

  async function exportCurrent() {
    try {
      const audio = audioFileData ? { name: audioFileName || audioFileData.name, type: audioFileData.type || 'audio/mpeg', dataUrl: await fileToDataUrl(audioFileData) } : null;
      const blob = new Blob([JSON.stringify({ ...state, format: 'vocal-emotion-studio', version: 3, audio }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `${state.title.replace(/[^a-z0-9áéíóúñ]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'cancion'}.vocal.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); showToast(audio ? 'Proyecto descargado con letra, ajustes y pista' : 'Proyecto descargado con letra y ajustes');
    } catch (error) { showToast(`No pude descargar: ${error.message}`); }
  }

  async function importSong(file) {
    try {
      const raw = JSON.parse(await file.text());
      if (typeof raw.lyrics !== 'string') throw new Error('El archivo no contiene una letra');
      raw.id = `song-${Date.now()}`; state = sanitizeSong(raw); updateEditorFromState(); persist(true);
      if (raw.audio?.dataUrl) {
        const response = await fetch(raw.audio.dataUrl), blob = await response.blob();
        loadAudio(new File([blob], raw.audio.name || 'pista-importada', { type: raw.audio.type || blob.type }), false);
      } else removeAudio();
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
    $('openNote').addEventListener('click', event => { event.stopPropagation(); openAnnotation(); }); $('clearSelection').addEventListener('click', event => { event.stopPropagation(); handleSelectionButton(); });
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
    $('pitchDown').addEventListener('click', () => setPitch(state.semitones - 1)); $('pitchUp').addEventListener('click', () => setPitch(state.semitones + 1)); $('pitchSlider').addEventListener('input', () => setPitch($('pitchSlider').value));
    $('detectTempo').addEventListener('click', () => detectTempo()); $('openSync').addEventListener('click', openSyncStudio);
    $('audioPlayer').addEventListener('loadedmetadata', () => { $('audioDuration').textContent = `${formatTime($('audioPlayer').duration)} · Lista para sincronizar`; updateTransport(); updateSyncTransport(); });
    $('audioPlayer').addEventListener('timeupdate', () => { updateSyncTransport(); updatePreparePlaybackCursor(); });
    $('audioPlayer').addEventListener('seeking', updatePreparePlaybackCursor);
    $('audioPlayer').addEventListener('seeked', () => { updatePreparePlaybackCursor(); if (!$('audioPlayer').paused) restartMetronomeIfPlaying(); });
    $('audioPlayer').addEventListener('play', () => { resumePitchAudio(); updateSyncTransport(); updatePreparePlaybackCursor(); if (!rehearsal.playing) startMetronome(); });
    $('audioPlayer').addEventListener('pause', () => { updateSyncTransport(); updatePreparePlaybackCursor(); if (!rehearsal.playing) stopMetronome(); });
    $('closeSync').addEventListener('click', closeSyncStudio); $('finishSync').addEventListener('click', closeSyncStudio); $('syncBackdrop').addEventListener('click', event => { if (event.target === $('syncBackdrop')) closeSyncStudio(); });
    $('syncPlayPause').addEventListener('click', toggleSyncPlayback); $('syncPrevious').addEventListener('click', () => moveSyncLine(-1)); $('syncNext').addEventListener('click', () => moveSyncLine(1));
    $('syncNudgeBack').addEventListener('click', () => nudgeSyncTime(-0.1)); $('syncNudgeForward').addEventListener('click', () => nudgeSyncTime(0.1));
    $('syncMark').addEventListener('click', markCurrentSyncLine); $('syncRemoveMark').addEventListener('click', removeCurrentSyncMark); $('clearSync').addEventListener('click', clearAllSyncMarks); $('resetSyncMarks').addEventListener('click', clearAllSyncMarks); $('completeSyncMarks').addEventListener('click', completeSyncMarks);
    $('syncSeek').addEventListener('input', () => { $('audioPlayer').currentTime = Number($('syncSeek').value); updateSyncTransport(); });
    $('startRehearsal').addEventListener('click', enterRehearsal); $('exitRehearsal').addEventListener('click', () => setMode('prepare')); $('rehearsalSettings').addEventListener('click', openMetronomeSettings);
    $('closeMetronome').addEventListener('click', closeMetronomeSettings); $('metronomeBackdrop').addEventListener('click', event => { if (event.target === $('metronomeBackdrop')) closeMetronomeSettings(); });
    $('liveBpmDown').addEventListener('click', () => setBpm(state.bpm - 1)); $('liveBpmUp').addEventListener('click', () => setBpm(state.bpm + 1));
    $('livePitchDown').addEventListener('click', () => setPitch(state.semitones - 1)); $('livePitchUp').addEventListener('click', () => setPitch(state.semitones + 1));
    $('liveBpm').addEventListener('change', () => setBpm($('liveBpm').value)); $('liveMeter').addEventListener('change', () => setMeter($('liveMeter').value));
    $('liveMetronomeEnabled').addEventListener('change', () => setMetronomeEnabled($('liveMetronomeEnabled').checked)); $('liveVolume').addEventListener('input', () => setMetronomeVolume($('liveVolume').value));
    $('playPause').addEventListener('click', toggleRehearsal); $('restartSong').addEventListener('click', restartSong); $('previousLine').addEventListener('click', () => moveLine(-1)); $('nextLine').addEventListener('click', () => moveLine(1));
    $('rehearsalFullscreen').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => showToast('Pantalla completa no disponible')));
    $('libraryButton').addEventListener('click', () => { stopRehearsal(); renderLibrary(); $('libraryBackdrop').hidden = false; }); $('closeLibrary').addEventListener('click', () => $('libraryBackdrop').hidden = true); $('libraryBackdrop').addEventListener('click', event => { if (event.target === $('libraryBackdrop')) $('libraryBackdrop').hidden = true; });
    $('newSong').addEventListener('click', createNewSong); $('exportSong').addEventListener('click', exportCurrent); $('importSong').addEventListener('click', () => $('importFile').click()); $('importFile').addEventListener('change', event => { const file = event.target.files?.[0]; if (file) importSong(file); event.target.value = ''; });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { if (!$('noteBackdrop').hidden) closeAnnotation(); else if (!$('libraryBackdrop').hidden) $('libraryBackdrop').hidden = true; else if (!$('metronomeBackdrop').hidden) closeMetronomeSettings(); else if (!$('syncBackdrop').hidden) closeSyncStudio(); }
      if (!$('syncBackdrop').hidden && event.key.toLowerCase() === 'm' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) { event.preventDefault(); markCurrentSyncLine(); }
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
