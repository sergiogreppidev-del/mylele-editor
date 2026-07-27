/* Pruebas de la notación MLN. Se corren con:  npm run probar
   (compila src/lib a pruebas/build y ejecuta este archivo con Node). */
const N = require('./build/notation.js');

let fails = 0;
function check(label, ok, detail) {
  console.log((ok ? '  OK  ' : ' FALLA') + ' · ' + label + (detail ? '  → ' + detail : ''));
  if (!ok) fails++;
}

console.log('\n=== Alturas y digitación ===');
check('G4 = MIDI 67', N.pitchToMidi('G4') === 67, String(N.pitchToMidi('G4')));
check('C4 = MIDI 60', N.pitchToMidi('C4') === 60);
check('A#3 = Bb3', N.pitchToMidi('A#3') === N.pitchToMidi('Bb3'));
check('67 → "G4"', N.midiToPitch(67) === 'G4');
check('A4 (69) → cuerda A al aire', JSON.stringify(N.midiToTab(69)) === '{"string":"A","fret":0}', JSON.stringify(N.midiToTab(69)));
check('G4 (67) → cuerda G al aire', JSON.stringify(N.midiToTab(67)) === '{"string":"G","fret":0}', JSON.stringify(N.midiToTab(67)));
check('C5 (72) → A traste 3 (el más bajo)', JSON.stringify(N.midiToTab(72)) === '{"string":"A","fret":3}', JSON.stringify(N.midiToTab(72)));
check('C4 (60) → C al aire', JSON.stringify(N.midiToTab(60)) === '{"string":"C","fret":0}', JSON.stringify(N.midiToTab(60)));
check('A5 (81) = tope del rango', N.midiToTab(81) !== null);
check('B3 (59) fuera de rango', N.midiToTab(59) === null);
check('A#5 (82) fuera de rango', N.midiToTab(82) === null);

console.log('\n=== Feliz cumpleaños · fondo (3/4) ===');
// Anacrusa de dos corcheas + tres compases.
const HB = '| G4/.5 G4/.5 | A4/1 G4/1 C5/1 | B4/2 r/1 | G4/.5 G4/.5 A4/1 G4/1 |';
const r1 = N.parseNotation(HB, { target: 'backing', beatsPerBar: 3, knownChords: [], autoTranspose: true });
const err1 = r1.issues.filter((i) => i.level === 'error');
check('sin errores', err1.length === 0, JSON.stringify(err1));
check('10 notas (el silencio no cuenta)', r1.backingEvents.length === 10, String(r1.backingEvents.length));
check('arranca en el beat 0', r1.backingEvents[0].t === 0);
check('la 2da corchea cae en .5', r1.backingEvents[1].t === 0.5, String(r1.backingEvents[1].t));
check('el A4 cae en el beat 1', r1.backingEvents[2].t === 1 && r1.backingEvents[2].pitch === 'A4');
check('el B4 cae en el beat 4', r1.backingEvents[5].t === 4 && r1.backingEvents[5].pitch === 'B4');
check('el silencio corre el tiempo: sigue en 7', r1.backingEvents[6].t === 7, String(r1.backingEvents[6].t));
check('dura 10 tiempos', r1.totalBeats === 10, String(r1.totalBeats));
check('avisa la anacrusa', r1.issues.some((i) => /anacrusa/.test(i.message)));

console.log('\n=== La misma melodía como nivel jugable ===');
const r2 = N.parseNotation(HB, { target: 'melody', beatsPerBar: 3, knownChords: [], autoTranspose: true });
check('sin errores', r2.issues.filter((i) => i.level === 'error').length === 0);
check('convirtió a cuerda+traste', r2.melodyEvents.every((e) => 'string' in e && 'fret' in e));
check('todo tocable (0..12)', r2.melodyEvents.every((e) => e.fret >= 0 && e.fret <= 12));
console.log('        primeras 3:', JSON.stringify(r2.melodyEvents.slice(0, 3)));

console.log('\n=== Transposición automática ===');
const grave = 'C3/1 E3/1 G3/1';
const r3 = N.parseNotation(grave, { target: 'melody', beatsPerBar: 4, knownChords: [], autoTranspose: true });
check('sin errores', r3.issues.filter((i) => i.level === 'error').length === 0);
check('subió una octava', r3.appliedShift === 12, String(r3.appliedShift));
check('avisa que transpuso', r3.issues.some((i) => /octava/.test(i.message)));
const imposible = 'C2/1 C7/1';
const r4 = N.parseNotation(imposible, { target: 'melody', beatsPerBar: 4, knownChords: [], autoTranspose: true });
check('rango imposible → error', r4.issues.some((i) => i.level === 'error'));

console.log('\n=== Acordes ===');
const prog = '| C/4 | Am/4 | F/2 G/2:u | C/4 |';
const r5 = N.parseNotation(prog, { target: 'chords', beatsPerBar: 4, knownChords: ['C', 'Am', 'F', 'G'] });
check('sin errores', r5.issues.filter((i) => i.level === 'error').length === 0, JSON.stringify(r5.issues));
check('5 acordes', r5.chordEvents.length === 5, String(r5.chordEvents.length));
check('el G arranca en el beat 10', r5.chordEvents[3].t === 10, String(r5.chordEvents[3].t));
check('el G va hacia arriba', r5.chordEvents[3].dir === 'u');
check('por defecto hacia abajo', r5.chordEvents[0].dir === 'd');
const r6 = N.parseNotation('| C/4 | Dm/4 |', { target: 'chords', beatsPerBar: 4, knownChords: ['C', 'Am'] });
check('acorde inexistente → error', r6.issues.some((i) => i.level === 'error' && /Dm/.test(i.message)));

console.log('\n=== Compases mal sumados ===');
// Un compás corrido desfasa todo lo que sigue, así que bloquea en vez de solo avisar.
const malo = '| C/4 | Am/3 | F/4 |';
const r7 = N.parseNotation(malo, { target: 'chords', beatsPerBar: 4, knownChords: ['C', 'Am', 'F'] });
const aviso = r7.issues.find((i) => /compás 2/.test(i.message));
check('detecta el compás 2', !!aviso, aviso && aviso.message);
check('un compás del medio mal sumado es ERROR', aviso && aviso.level === 'error', aviso && aviso.level);

// Los extremos sí pueden quedar cortos: anacrusa al principio, final incompleto.
const extremos = '| C/1 | C/4 | Am/4 | F/2 |';
const rx = N.parseNotation(extremos, { target: 'chords', beatsPerBar: 4, knownChords: ['C', 'Am', 'F'] });
check('anacrusa y final corto no bloquean',
  rx.issues.filter((i) => i.level === 'error').length === 0,
  JSON.stringify(rx.issues.map((i) => i.level + ': ' + i.message)));
check('igual se avisan los dos', rx.issues.filter((i) => i.level === 'warn').length === 2);

// Un compás MÁS LARGO que el compás nunca es válido, ni en los extremos.
const largo = '| C/5 | Am/4 |';
const rl = N.parseNotation(largo, { target: 'chords', beatsPerBar: 4, knownChords: ['C', 'Am'] });
check('un compás de más siempre es error', rl.issues.some((i) => i.level === 'error' && /sobra/.test(i.message)),
  JSON.stringify(rl.issues.map((i) => i.level + ': ' + i.message)));

// El caso real que falló: Feliz cumpleaños sin anacrusa y con compases de 4 y 5 en 3/4.
const hbMal = 'COMPAS: 3/4\nMELODIA: | G4/1 G4/1 A4/1 | G4/1 D5/1 C5/2 | G4/1 G4/1 A4/1 |';
const rhb = N.parseNotation(hbMal, { target: 'melody', beatsPerBar: 3, knownChords: [] });
check('el compás de 4 en 3/4 ahora bloquea',
  rhb.issues.some((i) => i.level === 'error' && /compás 2/.test(i.message)),
  JSON.stringify(rhb.issues.map((i) => i.level + ': ' + i.message)));

console.log('\n=== El pedido pide anacrusa y ritmo real ===');
{
  const P2 = require('./build/aiPrompt.js');
  const pn = P2.buildAiPrompt({ target: 'nivel', title: 'T', bpm: 80, timeSig: '4/4', beatsPerBar: 4,
                                bars: 8, knownChords: ['C', 'F', 'G'], pedido: 'Feliz cumpleaños', imponerMedida: false });
  check('explica la anacrusa', /ANACRUSA/.test(pn));
  check('menciona Feliz cumpleaños al explicar la anacrusa', /Feliz cumplea/.test(pn));
  // Pero el MINIEJEMPLO no puede ser esa canción. Lo era —arrancaba con las dos
  // corcheas del "Fe-liz"— y cuando justo se pedía Feliz cumpleaños, el modelo
  // copiaba el ejemplo y se daba por terminado a los tres compases.
  check('el miniejemplo NO es la canción del ejemplo', !/MELODIA: \| G4\/\.5 G4\/\.5/.test(pn));
  check('avisa que un compás corrido arruina todo', /corre todo lo que viene después/.test(pn));
  check('pide el ritmo real, no notas iguales', /no todas las notas iguales/.test(pn));
  check('pide las cuatro capas', /MELODIA:/.test(pn) && /BAJO:/.test(pn) && /ACOMP:/.test(pn) && /ACORDES:/.test(pn));
}

console.log('\n=== Basura ===');
const r8 = N.parseNotation('C/4 Hola/2 G4/xyz', { target: 'chords', beatsPerBar: 4, knownChords: ['C'] });
check('avisa de lo que no entiende', r8.issues.filter((i) => i.level === 'error').length >= 2, JSON.stringify(r8.issues.map((i) => i.message)));

console.log('\n=== La IA propone compás y tempo (cabecera) ===');
// Feliz cumpleaños como la devolvería la IA: ella dice la medida, no se la imponemos.
const conCabecera = 'BPM: 120\nCOMPAS: 3/4\n| G4/.5 G4/.5 | A4/1 G4/1 C5/1 | B4/2 r/1 |';
// El nivel está en 4/4 a 80: a propósito distinto, para ver que gana la cabecera.
const rh = N.parseNotation(conCabecera, { target: 'backing', beatsPerBar: 4, knownChords: [] });
check('lee el BPM propuesto', rh.suggested.bpm === 120, String(rh.suggested.bpm));
check('lee el compás propuesto', rh.suggested.timeSig === '3/4', rh.suggested.timeSig);
check('verifica los compases contra 3/4, no contra el 4/4 del nivel', rh.beatsPerBarUsed === 3, String(rh.beatsPerBarUsed));
check('la cabecera no se cuela como notas', rh.backingEvents.length === 6, String(rh.backingEvents.length));
const avisosFalsos = rh.issues.filter((i) => /debería sumar/.test(i.message));
check('sin avisos falsos de compás', avisosFalsos.length === 0, JSON.stringify(avisosFalsos.map((i) => i.message)));

// Sin cabecera se sigue usando la medida del nivel, como antes.
const rsc = N.parseNotation('| C/4 | Am/4 |', { target: 'chords', beatsPerBar: 4, knownChords: ['C', 'Am'] });
check('sin cabecera no propone nada', !rsc.suggested.bpm && !rsc.suggested.timeSig);
check('sin cabecera usa la medida del nivel', rsc.beatsPerBarUsed === 4);

// Tolerancia a cómo lo escriba la IA: acentos, minúsculas, "Tempo", "=".
const rtol = N.parseNotation('Tempo = 96\ncompás: 6/8\n| C/6 |', { target: 'chords', beatsPerBar: 4, knownChords: ['C'] });
check('tolera "Tempo =" y "compás:" en minúscula', rtol.suggested.bpm === 96 && rtol.suggested.timeSig === '6/8',
  JSON.stringify(rtol.suggested));

console.log('\n=== Acordes que cambian DENTRO del compás ===');
// Twinkle Twinkle de verdad: 12 compases y cambios a mitad de compás. Lo que la IA
// devolvía antes (16 compases de un acorde cada uno) no se parecía a la canción.
const twinkle = [
  'BPM: 100', 'COMPAS: 4/4',
  '| C/4 | F/2 C/2 | F/2 C/2 | G/2 C/2 |',
  '| C/2 G/2 | C/2 G/2 | C/2 G/2 | C/2 G/2 |',
  '| C/4 | F/2 C/2 | F/2 C/2 | G/2 C/2 |',
].join('\n');
const rt = N.parseNotation(twinkle, { target: 'chords', beatsPerBar: 4, knownChords: ['C', 'F', 'G', 'Am'] });
const errT = rt.issues.filter((i) => i.level === 'error');
check('sin errores', errT.length === 0, JSON.stringify(errT.map((i) => i.message)));
const avisosT = rt.issues.filter((i) => /debería sumar/.test(i.message));
check('los 12 compases suman bien', avisosT.length === 0, JSON.stringify(avisosT.map((i) => i.message)));
check('22 acordes (7 + 8 + 7)', rt.chordEvents.length === 22, String(rt.chordEvents.length));
check('dura 48 tiempos = 12 compases', rt.totalBeats === 48, String(rt.totalBeats));
check('el 2do acorde entra en el beat 4', rt.chordEvents[1].t === 4 && rt.chordEvents[1].chord === 'F');
check('el cambio de mitad de compás cae en el beat 6',
  rt.chordEvents[2].t === 6 && rt.chordEvents[2].chord === 'C', JSON.stringify(rt.chordEvents[2]));

console.log('\n=== Polifonía en el fondo (corchetes) ===');
const poli = 'FONDO: | [C3,E3,G3]/2 [F3,A3,C4]/2 | [G3,B3,D4]/4 |';
const rp = N.parseNotation(poli, { target: 'backing', beatsPerBar: 4, knownChords: [] });
check('sin errores', rp.issues.filter((i) => i.level === 'error').length === 0,
  JSON.stringify(rp.issues.map((i) => i.message)));
check('9 notas (3 acordes de 3)', rp.backingEvents.length === 9, String(rp.backingEvents.length));
check('las 3 primeras arrancan juntas en 0',
  rp.backingEvents.slice(0, 3).every((e) => e.t === 0), JSON.stringify(rp.backingEvents.slice(0, 3)));
check('el 2do acorde entra en el beat 2', rp.backingEvents[3].t === 2);
check('el compás avanza por token, no por nota', rp.totalBeats === 8, String(rp.totalBeats));
check('varias notas juntas ya no dan aviso', N.validateBacking(rp.backingEvents).length === 0,
  JSON.stringify(N.validateBacking(rp.backingEvents)));

const poliMal = 'MELODIA: | [C4,E4]/2 r/2 |';
const rpm = N.parseNotation(poliMal, { target: 'melody', beatsPerBar: 4, knownChords: [] });
check('corchetes en lo que toca el alumno → error',
  rpm.issues.some((i) => i.level === 'error' && /una nota por vez/.test(i.message)),
  JSON.stringify(rpm.issues.map((i) => i.message)));

console.log('\n=== Un nivel entero en un solo pegado ===');
const nivel = [
  'BPM: 100',
  'COMPAS: 4/4',
  'FONDO:   | [C3,E3,G3]/4 | [F3,A3,C4]/2 [C3,E3,G3]/2 |',
  'MELODIA: | C4/1 C4/1 G4/1 G4/1 | A4/1 A4/1 G4/2 |',
  'ACORDES: | C/4 | F/2 C/2 |',
].join('\n');
const rn = N.parseNotation(nivel, { target: 'chords', beatsPerBar: 4, knownChords: ['C', 'F', 'G', 'Am'] });
const errN = rn.issues.filter((i) => i.level === 'error');
check('sin errores', errN.length === 0, JSON.stringify(errN.map((i) => i.message)));
check('lee el BPM del nivel', rn.suggested.bpm === 100);
check('lee el compás del nivel', rn.suggested.timeSig === '4/4');
check('fondo: 9 notas', rn.backingEvents.length === 9, String(rn.backingEvents.length));
check('melodía: 7 notas en tablatura', rn.melodyEvents.length === 7, String(rn.melodyEvents.length));
check('acordes: 3', rn.chordEvents.length === 3, String(rn.chordEvents.length));
check('las tres capas duran 8 tiempos', rn.totalBeats === 8, String(rn.totalBeats));
check('la melodía se convirtió a cuerda+traste', rn.melodyEvents.every((e) => 'string' in e && 'fret' in e));
check('el acorde del compás 2 cambia en el beat 6',
  rn.chordEvents[2].t === 6 && rn.chordEvents[2].chord === 'C', JSON.stringify(rn.chordEvents[2]));

const nivelMal = ['COMPAS: 4/4', 'MELODIA: | C4/1 C4/1 |', 'ACORDES: | Xx/4 |'].join('\n');
const rnm = N.parseNotation(nivelMal, { target: 'chords', beatsPerBar: 4, knownChords: ['C'] });
check('el aviso dice de qué capa es',
  rnm.issues.some((i) => /^Acordes · /.test(i.message)),
  JSON.stringify(rnm.issues.map((i) => i.message)));

console.log('\n=== Anacrusa: se detecta y las barras se corren ===');
const F = require('./build/chartFormat.js');
// El caso real: Feliz cumpleaños con anacrusa de 1 tiempo en 3/4.
const conAlzada = 'COMPAS: 3/4\nACORDES: | r/1 | C/3 | G/3 | G/3 |';
const ra = N.parseNotation(conAlzada, { target: 'chords', beatsPerBar: 3, knownChords: ['C', 'G'] });
check('detecta la anacrusa de 1 tiempo', ra.suggested.pickup === 1, String(ra.suggested.pickup));
check('sin errores (la alzada no bloquea)', ra.issues.filter((i) => i.level === 'error').length === 0);
check('el primer acorde arranca en el beat 1', ra.chordEvents[0].t === 1, String(ra.chordEvents[0].t));

// Sin anacrusa no se inventa ninguna.
const sinAlzada = N.parseNotation('COMPAS: 3/4\nACORDES: | C/3 | G/3 |', { target: 'chords', beatsPerBar: 3, knownChords: ['C', 'G'] });
check('sin primer compás corto no propone anacrusa', sinAlzada.suggested.pickup === undefined);

// Las barras: con alzada de 1 en 3/4 van en 1, 4, 7... no en 3, 6, 9.
check('las barras se corren con la anacrusa',
  JSON.stringify(F.barLines(10, '3/4', 1)) === JSON.stringify([1, 4, 7]),
  JSON.stringify(F.barLines(10, '3/4', 1)));
check('sin anacrusa las barras van cada N desde cero',
  JSON.stringify(F.barLines(10, '3/4', 0)) === JSON.stringify([3, 6, 9]),
  JSON.stringify(F.barLines(10, '3/4', 0)));
check('con anacrusa se dibuja un compás más (el de alzada)',
  F.barCount([{ t: 0, dur: 25 }], '3/4', 1, 1) === 9, String(F.barCount([{ t: 0, dur: 25 }], '3/4', 1, 1)));

console.log('\n=== Voces del fondo (melodía, bajo, acompañamiento) ===');
const conVoces = [
  'COMPAS: 3/4',
  'MELODIA: | G4/1 A4/1 B4/1 |',
  'BAJO:    | C2/1 G2/1 E2/1 |',
  'ACOMP:   | r/1 [E3,G3]/1 [C4,E4]/1 |',
].join('\n');
const rv = N.parseNotation(conVoces, { target: 'backing', beatsPerBar: 3, knownChords: [] });
check('sin errores', rv.issues.filter((i) => i.level === 'error').length === 0,
  JSON.stringify(rv.issues.map((i) => i.message)));
const bajo = rv.backingEvents.filter((e) => e.v === 'bass');
const acomp = rv.backingEvents.filter((e) => e.v === 'acomp');
check('el bajo queda marcado como bass', bajo.length === 3, String(bajo.length));
check('el acompañamiento queda marcado como acomp', acomp.length === 4, String(acomp.length));
check('la melodía va a su propia capa, no al fondo', rv.melodyEvents.length === 3 && rv.backingEvents.length === 7,
  `mel=${rv.melodyEvents.length} fondo=${rv.backingEvents.length}`);
check('FONDO sin voz explícita cuenta como acompañamiento',
  N.parseNotation('FONDO: | C3/1 |', { target: 'backing', beatsPerBar: 1, knownChords: [] })
    .backingEvents[0].v === 'acomp');

console.log('\n=== El pedido pide un arreglo, no un metrónomo ===');
{
  const P3 = require('./build/aiPrompt.js');
  const pa = P3.buildAiPrompt({ target: 'nivel', title: 'T', bpm: 80, timeSig: '3/4', beatsPerBar: 3,
                                bars: 8, knownChords: ['C', 'F', 'G'], pedido: 'x', imponerMedida: false });
  check('separa la música del juego', /MELODIA \+ BAJO \+ ACOMP son LA M[UÚ]SICA/.test(pa));
  check('dice que la música no tiene límite de dificultad', /ninguna limitaci[oó]n de dificultad/.test(pa));
  check('advierte contra el metrónomo con alturas', /met[rn][oó]nomo con alturas|suena a metr[oó]nomo/.test(pa));
  check('pide que el bajo se mueva', /BAJO: que se mueva/.test(pa));
  check('pide arpegios en vez de bloques', /arpegios en vez de bloques/.test(pa));
  check('pide las cuatro capas', /MELODIA:/.test(pa) && /BAJO:/.test(pa) && /ACOMP:/.test(pa) && /ACORDES:/.test(pa));

  // Lo que causaba las respuestas incompletas: el ejemplo era la misma canción
  // pedida, de 3 compases, y era lo último que leía el modelo.
  check('no dice "tres capas" en ningún lado', !/tres capas/i.test(pa));
  check('el ejemplo se presenta como miniejemplo, no como respuesta', /NO es tu respuesta|NO es una canci[oó]n ni es tu respuesta/.test(pa));
  check('pide la canción entera', /ESCRIB[IÍ] LA CANCI[OÓ]N ENTERA/.test(pa));
  check('prohíbe abreviar', /se repite/.test(pa) && /Prohibido abreviar/.test(pa));
  check('permite partir una capa en varios renglones', /varios renglones/.test(pa));
  check('tiene verificación final', /ANTES DE RESPONDER, VERIFIC/.test(pa));
  check('la verificación va después del ejemplo',
    pa.indexOf('ANTES DE RESPONDER') > pa.indexOf('MINIEJEMPLO'));
  check('lo último es la instrucción de respuesta', pa.trim().endsWith('Empezá directamente con "BPM:".'));

  // Los pedidos de una sola capa tenían el mismo anclaje.
  const p1c = P3.buildAiPrompt({ target: 'chords', title: 'T', bpm: 80, timeSig: '4/4', beatsPerBar: 4,
                                 bars: 8, knownChords: ['C', 'F'], pedido: 'x', imponerMedida: false });
  check('una capa sola también pide completo', /ESCRIBILO COMPLETO/.test(p1c) && /NO es tu respuesta/.test(p1c));
}

console.log('\n=== El pedido que se le manda a la IA ===');
const P = require('./build/aiPrompt.js');
const base = { target: 'chords', title: 'T', bpm: 80, timeSig: '4/4', beatsPerBar: 4, bars: 8,
               knownChords: ['C', 'Am', 'F', 'G'], pedido: 'Twinkle Twinkle', imponerMedida: false };
const p1 = P.buildAiPrompt(base);
check('le prohíbe estirar para redondear', /no estires ni repitas/i.test(p1));
check('le pide que declare BPM y compás', /BPM: <n/.test(p1) && /COMPAS: </.test(p1));
check('saca el acorde de la melodía, no de la memoria', /no de la memoria/.test(p1));

const p2 = P.buildAiPrompt({ ...base, melodiaDelNivel: 'C4/1 C4/1 G4/1 G4/1 | A4/1 A4/1 G4/2' });
check('incluye la melodía del nivel cuando la hay', /armoniz[aá] exactamente esta/i.test(p2) && /C4\/1 C4\/1 G4\/1/.test(p2));
check('sin melodía no la menciona', !/armoniz[aá] exactamente esta/i.test(p1));

const p3 = P.buildAiPrompt({ ...base, imponerMedida: true });
check('con medida impuesta sí fija los compases', /Extensi[oó]n: 8 compases/.test(p3));
check('con medida impuesta no pide la cabecera', !/BPM: <n/.test(p3));

/* Los dos sub-niveles de la etapa Fácil usan los MISMOS acordes: lo único que los
   separa es cuántos entran por compás. Y ese límite es solo de la capa que toca el
   alumno — la música de fondo no se toca, que es el error que más se repite. */
console.log('\n=== El sub-nivel cambia la densidad de acordes ===');
{
  const facil = P.buildAiPrompt({ ...base, dificultad: 'facil' });
  const dificil = P.buildAiPrompt({ ...base, dificultad: 'dificil' });
  check('sin especificar, es el sub-nivel fácil', P.buildAiPrompt(base) === facil);

  check('fácil: exige uno por compás', /UN SOLO acorde por comp[aá]s/.test(facil));
  check('fácil: prohíbe DOS acordes distintos en el mismo compás',
    /prohibido que en un mismo comp[aá]s haya DOS acordes distintos/i.test(facil));
  check('fácil: pide que el acorde dure dos compases', /DOS COMPASES O M[AÁ]S/.test(facil));
  check('fácil: le da una salida honesta si la canción no entra', /NOTA:/.test(facil));
  check('fácil: en esta etapa no hay rasgueos hacia arriba', /No uses ":u"/.test(facil));

  check('difícil: permite cambiar en la mitad del compás',
    /cambiar de acorde en la mitad del comp[aá]s/.test(dificil));
  check('difícil: no exige dos compases por acorde', !/DOS COMPASES O M[AÁ]S/.test(dificil));
  check('difícil: prohíbe tres o más', /Nunca tres o m[aá]s/.test(dificil));
  check('difícil: el ejemplo parte un compás', /\| Am\/4 \| F\/2 C\/2 \| G\/4 \|/.test(dificil));

  /* ESTA REGLA SE DIO VUELTA, Y A PROPÓSITO.
     Antes decía que "C/2 C/2" era un error, porque un elemento se leía como "un
     acorde" en vez de como "un rasgueo". Con esa lectura, la única forma de escribir
     un compás de Do era "C/4", y de ahí salía un golpe por compás de punta a punta.
     Ahora "C/2 C/2" es lo correcto cuando la melodía se mueve en la mitad: son DOS
     rasgueos del MISMO acorde. Lo que sigue prohibido son dos acordes DISTINTOS. */
  check('ya no trata "C/2 C/2" como un error',
    !/tienen que ser DISTINTOS/.test(dificil) && !/tienen que ser DISTINTOS/.test(facil));

  /* EL RASGUEO SIGUE A LA MELODÍA — la corrección que motivó todo esto.
     El pedido viejo pedía literalmente "en 4/4 son todos X/4", y eso obligaba a
     cortar el acorde donde la canción sostiene. */
  for (const [nombre, p] of [['fácil', facil], ['difícil', dificil]]) {
    check(`${nombre}: ya no pide que todos ocupen el compás entero`,
      !/en 4\/4 son todos "X\/4"/.test(p));
    check(`${nombre}: explica que un elemento es UN rasgueo, no un acorde`,
      /es UN rasgueo, y su duraci[oó]n es cu[aá]nto lo dej[aá]s sonar/.test(p));
    check(`${nombre}: pide que el rasgueo siga a la melodía`,
      /donde la melod[ií]a se MUEVE, se rasguea/.test(p));
    check(`${nombre}: ofrece la ligadura para cruzar el compás`, /"F\/3 \| ~\/3"/.test(p));
    check(`${nombre}: acepta silencios en el rasgueo`, /Los SILENCIOS valen/.test(p));
    check(`${nombre}: aclara que el límite es de cambios, no de golpes`,
      /NO limita cu[aá]ntas veces se rasguea/.test(p));
    // El ejemplo tiene que MOSTRAR la regla: si todos los golpes duran lo mismo,
    // el modelo copia el ejemplo y volvemos al metrónomo.
    const ejemplo = /MINIEJEMPLO[\s\S]*?\n(\| [^\n]*\|)/.exec(p);
    check(`${nombre}: el ejemplo no tiene todos los golpes iguales`,
      !!ejemplo && new Set([...ejemplo[1].matchAll(/\/([\d.]+)/g)].map((m) => m[1])).size > 1,
      ejemplo && ejemplo[1]);
  }

  // Los acordes permitidos: el pedido tiene que nombrarlos, y solo esos.
  const soloFaciles = P.buildAiPrompt({ ...base, dificultad: 'facil', acordesPermitidos: ['Am', 'C', 'F'] });
  check('el pedido nombra los acordes permitidos', /Usá SOLO estos acordes: Am, C, F/.test(soloFaciles));
  check('y no ofrece el G en ningún lado de la regla',
    !/Am, C, F, G/.test(soloFaciles.split('MANO IZQUIERDA')[1] ?? ''));
  check('sin lista explícita, cae al catálogo entero tal como viene',
    /Usá SOLO estos acordes: C, Am, F, G/.test(P.buildAiPrompt({ ...base, dificultad: 'facil' })));

  // Nivel completo: el límite tiene que aplicar SOLO al renglón de acordes.
  const nivel = { target: 'nivel', title: 'T', bpm: 80, timeSig: '4/4', beatsPerBar: 4, bars: 8,
                  knownChords: ['C', 'Am', 'F', 'G'], pedido: 'x', imponerMedida: false };
  const nivelF = P.buildAiPrompt({ ...nivel, dificultad: 'facil' });
  const nivelD = P.buildAiPrompt({ ...nivel, dificultad: 'dificil' });
  check('nivel · fácil: uno por compás', /UN SOLO acorde por comp[aá]s/.test(nivelF));
  check('nivel · difícil: permite cambiar en la mitad',
    /cambiar de acorde en la mitad del comp[aá]s/.test(nivelD));
  check('nivel · el límite es solo de ACORDES', /SOLO el rengl[oó]n ACORDES/.test(nivelF));
  check('nivel · la música sigue sin límite en los dos',
    /ninguna limitaci[oó]n de dificultad/.test(nivelF) && /ninguna limitaci[oó]n de dificultad/.test(nivelD));
  check('nivel · la verificación final se adapta',
    /UN SOLO acorde por comp[aá]s/.test(nivelF) && /m[aá]s de DOS acordes/.test(nivelD));

  /* El pedido de nivel entero es el único que tiene la melodía delante mientras
     escribe los acordes, así que es el único donde se puede pedir la comparación
     directa. Es también el que más se usa. */
  check('nivel · manda comparar ACORDES contra MELODIA compás por compás',
    /copi[aá] SU ritmo en el de ACORDES/.test(nivelF));
  check('nivel · la verificación final incluye el ritmo del rasgueo',
    /Compar[aá] ACORDES contra MELODIA comp[aá]s por comp[aá]s/.test(nivelF));
  check('nivel · el miniejemplo muestra una ligadura en ACORDES',
    /ACORDES: .*~\/3/.test(nivelF), /ACORDES: [^\n]*/.exec(nivelF)?.[0]);
  check('nivel · el miniejemplo de ACORDES no tiene todos los golpes iguales',
    // Anclado al principio de renglón: la sección de reglas también tiene un
    // "- ACORDES: ..." y ese no lleva ninguna duración.
    new Set([...(/^ACORDES: ([^\n]*)/m.exec(nivelF)?.[1] ?? '').matchAll(/\/([\d.]+)/g)]
      .map((m) => m[1])).size > 1);
  check('nivel · sigue pidiendo no simplificar la música por el límite',
    /sin haberlos simplificado por el l[ií]mite/.test(nivelF));
}

/* Caso real: la IA se quedó sin espacio y cortó la respuesta a la mitad de la
   palabra "ACORDES". Ese pedazo suelto generaba DOS errores, ninguno de los
   cuales nombraba la causa: lo leía como nota, y hacía que el último compás
   dejara de ser el último y perdiera el permiso de terminar corto. */
/* El pedido de UNA capa se habia quedado atras del pedido de nivel entero: no
   mencionaba la anacrusa, no pedia ritmo real, no avisaba que un compas mal
   sumado corre todo, y el miniejemplo ERA el arranque de Feliz cumpleaños. */
/* ===================================================================
   Elegir qué chart se edita.

   Esta parte no tenía NINGUNA prueba, y ahí se escondieron los dos peores
   errores que tuvimos: agarrar el primer chart de la lista (la app terminó
   tocando el acompañamiento en vez de los acordes) y preguntar siempre por
   el sub-nivel 'facil' (el editor mostraba como borrador vacío una canción
   publicada y en vivo). Reproduzco los dos casos exactos.
   =================================================================== */
console.log('\n=== Qué chart se edita (la parte que no estaba cubierta) ===');
{
  const K = require('./build/chartPick.js');
  const ch = (mode, difficulty, version, published) => ({ mode, difficulty, version, published });

  // El caso real de cumpleanos-feliz: acordes publicados en el SEGUNDO sub-nivel.
  // PostgREST devolvió el fondo primero, que es lo que rompía "el primero de la lista".
  const feliz = [ch('backing', 'facil', 1, true), ch('chords', 'dificil', 1, true)];
  check('el fondo no se confunde con lo jugable', K.songMode(feliz) === 'chords');
  check('encuentra el sub-nivel donde vive la canción', K.songDifficulty(feliz) === 'dificil');
  check('el chart jugable aparece aunque esté en el otro sub-nivel', !!K.playableChart(feliz));
  check('y sigue viéndose como publicado', K.playableChart(feliz).published === true);
  check('preguntar por el sub-nivel equivocado da vacío (por eso no hay que preguntar)',
    K.workingChart(feliz, 'chords', 'facil') === null);
  check('preguntar por el correcto sí lo trae', !!K.workingChart(feliz, 'chords', 'dificil'));

  // El orden de la lista no puede decidir nada.
  const alReves = [ch('chords', 'dificil', 1, true), ch('backing', 'facil', 1, true)];
  check('el orden de los charts no cambia el resultado',
    K.songMode(alReves) === K.songMode(feliz) && K.songDifficulty(alReves) === K.songDifficulty(feliz));

  // Un nivel de notas tiene que reconocerse como tal.
  const notas = [ch('melody', 'facil', 1, true), ch('backing', 'facil', 1, true)];
  check('un nivel de notas se reconoce', K.songMode(notas) === 'melody');
  check('un nivel vacío cuenta como de acordes', K.songMode([]) === 'chords');
  check('un nivel vacío arranca en el primer sub-nivel', K.songDifficulty([]) === 'facil');

  // Entre publicado y borrador, para saber QUÉ ES el nivel gana el publicado.
  const mezcla = [ch('chords', 'facil', 2, false), ch('chords', 'facil', 1, true)];
  check('para identificar el nivel gana el publicado', K.playableChart(mezcla).version === 1);
  // Pero para EDITAR gana el borrador: es lo que se está trabajando.
  check('para editar gana el borrador', K.workingChart(mezcla, 'chords', 'facil').version === 2);
  check('lo publicado se encuentra aparte', K.publishedChart(mezcla, 'chords', 'facil').version === 1);

  // Sin publicar, manda la versión más alta y nunca "la primera de la lista".
  const borradores = [ch('chords', 'facil', 1, false), ch('chords', 'facil', 3, false), ch('chords', 'facil', 2, false)];
  check('entre borradores gana la versión más alta', K.workingChart(borradores, 'chords', 'facil').version === 3);
  check('no hay publicado que encontrar', K.publishedChart(borradores, 'chords', 'facil') === null);

  // Versionado: un borrador nuevo va por encima de todo lo que exista.
  check('la próxima versión es la siguiente a la más alta', K.nextVersion(borradores, 'chords', 'facil') === 4);
  check('la primera versión de una combinación nueva es 1', K.nextVersion(borradores, 'chords', 'dificil') === 1);
  check('el versionado no mezcla sub-niveles', K.nextVersion(feliz, 'chords', 'facil') === 1);

  // El fondo es uno solo para los dos sub-niveles: siempre vive en el primero.
  const conFondo = [ch('backing', 'facil', 1, true)];
  check('el fondo se encuentra pidiéndolo con cualquier sub-nivel',
    !!K.workingChart(conFondo, 'backing', 'dificil') && !!K.workingChart(conFondo, 'backing', 'facil'));
  check('el fondo nunca cuenta como jugable', K.playableChart(conFondo) === null);
  check('difficultyFor manda el fondo al primer sub-nivel',
    K.difficultyFor('backing', 'dificil') === 'facil' && K.difficultyFor('chords', 'dificil') === 'dificil');

  // Pisar un borrador existente en vez de crear versiones infinitas.
  check('se pisa el borrador más nuevo', K.draftToOverwrite(borradores, 'chords', 'facil').version === 3);
  check('si solo hay publicado, no hay borrador que pisar',
    K.draftToOverwrite(feliz, 'chords', 'dificil') === null);

  check('difficultiesPresent ignora el fondo',
    JSON.stringify(K.difficultiesPresent(feliz)) === JSON.stringify(['dificil']));
}

console.log('\n=== El pedido de notas sueltas (tablatura) ===');
{
  const mel = P.buildAiPrompt({ target: 'melody', title: 'T', bpm: 100, timeSig: '3/4',
    beatsPerBar: 3, bars: 8, knownChords: ['C', 'Am', 'F', 'G'], pedido: 'Feliz cumpleaños',
    imponerMedida: false });

  check('explica la anacrusa', /ANACRUSA:/.test(mel));
  check('pide el ritmo real, no notas iguales', /no todas las notas iguales/.test(mel));
  check('avisa que un compás mal sumado corre todo', /corre todo lo que viene despu[eé]s/.test(mel));
  check('exige el rango del ukelele', /entre C4 y A5/.test(mel));
  check('pide una sola voz', /Una sola voz/.test(mel));
  check('tiene verificación final', /ANTES DE RESPONDER, VERIFIC/.test(mel));
  check('la verificación va última', mel.trim().endsWith('que es lo que se puede tocar en el ukelele?'));

  // El anclaje: el ejemplo no puede ser la canción que se está pidiendo.
  check('el miniejemplo ya NO es Feliz cumpleaños', !/G4\/\.5 G4\/\.5 \| A4\/1 G4\/1 C5\/1/.test(mel));
  check('el miniejemplo muestra anacrusa', /\| D4\/1 \| F4\/1 A4\/1\.5 G4\/\.5 \| E4\/2 r\/1 \|/.test(mel));
  check('aclara que el ejemplo no es una canción', /NO es tu respuesta ni es una canci[oó]n/.test(mel));

  // El fondo comparte el camino, salvo el rango.
  const fondo = P.buildAiPrompt({ target: 'backing', title: 'T', bpm: 100, timeSig: '4/4',
    beatsPerBar: 4, bars: 8, knownChords: [], pedido: 'x', imponerMedida: false });
  check('el fondo también explica la anacrusa', /ANACRUSA:/.test(fondo));
  check('el fondo no se limita al rango del ukelele', /cualquier octava/.test(fondo));

  /* Un nivel completo tiene que respetar el TIPO que eligió el autor. Antes el
     pedido siempre incluía acordes, la IA siempre los devolvía, y el editor
     deducía "nivel de acordes": no había forma de crear uno de notas. */
  const nivelBase = { target: 'nivel', title: 'T', bpm: 90, timeSig: '4/4', beatsPerBar: 4,
    bars: 8, knownChords: ['C', 'Am', 'F', 'G'], pedido: 'x', imponerMedida: false };
  const nAc = P.buildAiPrompt({ ...nivelBase, modo: 'chords' });
  const nNo = P.buildAiPrompt({ ...nivelBase, modo: 'melody' });

  check('nivel de acordes: pide las cuatro capas', /cuatro capas/.test(nAc) && /ACORDES:/.test(nAc));
  check('nivel de acordes: el juego son los acordes', /ACORDES es EL JUEGO/.test(nAc));

  check('nivel de notas: pide tres capas', /tres capas/.test(nNo));
  check('nivel de notas: prohíbe el renglón de acordes', /NO escribas un rengl[oó]n ACORDES/.test(nNo));
  check('nivel de notas: no hay ejemplo de acordes que copiar', !/^ACORDES:/m.test(nNo));
  check('nivel de notas: el juego es la melodía', /MELODIA es EL JUEGO/.test(nNo));
  check('nivel de notas: exige el rango del ukelele', /entre\s+C4 y A5/.test(nNo));
  check('nivel de notas: no le pone límite de acordes por compás', !/ACORDES POR COMP/.test(nNo));
  check('nivel de notas: el acompañamiento sostiene la armonía', /sostener la armon[ií]a/.test(nNo));
  check('nivel de notas: la verificación pide cinco renglones', /cinco renglones/.test(nNo));
  check('sin modo, sigue siendo un nivel de acordes (como antes)',
    P.buildAiPrompt(nivelBase) === nAc);
  check('en los dos, la música sigue sin límite',
    /ninguna limitaci[oó]n de dificultad/.test(nAc) && /ninguna limitaci[oó]n de dificultad/.test(nNo));

  // Y los acordes: la anacrusa sí, el "ritmo real" de sílabas no viene al caso.
  const ac = P.buildAiPrompt({ ...base });
  check('acordes también explican la anacrusa', /ANACRUSA:/.test(ac));
  check('acordes no hablan de sílabas en corcheas', !/no todas las notas iguales/.test(ac));
}

console.log('\n=== Respuesta de la IA cortada por la mitad ===');
{
  const truncado = [
    'BPM: 100',
    'COMPAS: 3/4',
    'MELODIA: | G4/1 A4/1 B4/1 | C5/2 |',
    'ACOMP: | [C3,E3,G3]/1 r/1 r/1 | [C3,E3,G3]/2 |',
    'ACORD',
  ].join('\n');
  const rt = N.parseNotation(truncado, {
    target: 'chords', beatsPerBar: 4, knownChords: ['C', 'Am', 'F', 'G'], autoTranspose: true,
  });
  const errores = rt.issues.filter((i) => i.level === 'error');

  check('avisa que la respuesta se cortó', rt.issues.some((i) => /se cort[oó] antes de terminar/.test(i.message)));
  check('nombra el fragmento que quedó suelto', rt.issues.some((i) => /"ACORD"/.test(i.message)));
  check('ya no lo confunde con una nota', !rt.issues.some((i) => /ACORD.*no es una nota/.test(i.message)));
  check('el último compás vuelve a poder terminar corto',
    !errores.some((i) => /compás 2 suma/.test(i.message)), JSON.stringify(errores.map((i) => i.message)));
  check('un solo error, y es el del corte', errores.length === 1, JSON.stringify(errores.map((i) => i.message)));
  check('lo que sí llegó se conserva',
    rt.melodyEvents.length === 4 && rt.backingEvents.length === 6,
    `mel=${rt.melodyEvents.length} fondo=${rt.backingEvents.length}`);

  // Y lo importante: no gritar "se cortó" cuando la respuesta llegó entera.
  const ok = N.parseNotation('| C/4 | Am/4 | F/2 G/2 | C/4',
    { target: 'chords', beatsPerBar: 4, knownChords: ['C', 'Am', 'F', 'G'] });
  check('no marca corte en una respuesta completa', !ok.issues.some((i) => /se cort/.test(i.message)));
  const okMel = N.parseNotation('| G4/1 A4/1 B4/1 C5/1 |',
    { target: 'melody', beatsPerBar: 4, knownChords: [] });
  check('una melodía que termina en nota tampoco', !okMel.issues.some((i) => /se cort/.test(i.message)));
}

/* ===================================================================
   Control de calidad de una cancion.

   Los dos defectos que mas veces hubo que corregir a mano: la armonia
   que no es de la cancion, y el acompanamiento que suena a metronomo.
   =================================================================== */
console.log('\n=== La armonia calza con la melodia ===');
{
  const Q = require('./build/calidad.js');
  const PCS = { C: [0, 4, 7], Am: [9, 0, 4], F: [5, 9, 0], G: [7, 11, 2] };
  const ac = (chord, t, dur) => ({ t, chord, dur, dir: 'd' });
  const no = (t, dur, midi) => ({ t, dur, midi });

  // C mayor (C E G) con una melodia que canta C, E, G: cierra.
  const bien = Q.verificarArmonia([ac('C', 0, 4)], [no(0, 2, 60), no(2, 2, 64)], PCS);
  check('un acorde que contiene la melodia no da aviso', bien.length === 0);

  // El mismo compas con un F: no comparte NINGUNA nota con lo que suena.
  const mal = Q.verificarArmonia([ac('F', 0, 4)], [no(0, 2, 62), no(2, 2, 71)], PCS);
  check('detecta el acorde que no contiene ninguna nota', mal.length === 1 && mal[0].ninguna === true);
  check('dice cuales son las notas que sobran', mal[0].ajenas.sort().join() === 'B,D');

  // Nota de paso corta: normal, no tiene que molestar.
  const paso = Q.verificarArmonia([ac('C', 0, 4)], [no(0, 3.5, 60), no(3.5, 0.5, 62)], PCS);
  check('una nota de paso corta no da aviso', paso.length === 0);

  // Mayoria ajena: aviso mas suave, no error.
  const mayoria = Q.verificarArmonia([ac('C', 0, 4)], [no(0, 3, 62), no(3, 1, 60)], PCS);
  check('si la mayoria queda afuera, avisa sin decir "ninguna"',
    mayoria.length === 1 && mayoria[0].ninguna === false);

  // Sin melodia no se puede juzgar nada.
  check('sin melodia no inventa avisos', Q.verificarArmonia([ac('C', 0, 4)], [], PCS).length === 0);

  // El indice sirve para marcarlo en pantalla.
  const varios = Q.verificarArmonia([ac('C', 0, 4), ac('F', 4, 4)], [no(0, 4, 60), no(4, 4, 71)], PCS);
  check('devuelve el indice del acorde que falla', varios.length === 1 && varios[0].index === 1);

  // Los avisos ubican el compas para poder ir a mirarlo.
  const avisos = Q.avisosDeArmonia(varios, '4/4', 0);
  check('el aviso dice en que compas', /compás 2/.test(avisos[0].message), avisos[0].message);
  check('no contener ninguna nota es error, no aviso', avisos[0].level === 'error');
  check('la anacrusa se nombra como tal',
    /anacrusa/.test(Q.avisosDeArmonia(Q.verificarArmonia([ac('F', 0, 1)], [no(0, 1, 71)], PCS), '4/4', 1)[0].message));

  // De donde sale la melodia: capa jugable o fondo marcado como 'lead'.
  const desdeFondo = Q.melodiaDelNivel([], [
    { t: 0, pitch: 'C4', dur: 1, v: 'lead' },
    { t: 0, pitch: 'C2', dur: 1, v: 'bass' },
  ]);
  check('en un nivel de acordes la melodia sale del fondo (lead)',
    desdeFondo.length === 1 && desdeFondo[0].midi === 60);
  const desdeTab = Q.melodiaDelNivel([{ t: 0, string: 'C', fret: 0, dur: 1 }], []);
  check('en un nivel de notas sale de la tablatura', desdeTab.length === 1 && desdeTab[0].midi === 60);
  check('el bajo nunca se confunde con la melodia', desdeFondo.every((n) => n.midi === 60));
}

console.log('\n=== Musica o metronomo ===');
{
  const Q = require('./build/calidad.js');
  const n = (t, dur, pitch, v) => ({ t, dur, pitch, v });

  // 8 compases identicos: exactamente el defecto que hubo que corregir a mano.
  const clavado = [];
  for (let c = 0; c < 8; c++) {
    clavado.push(n(c * 4, 1, 'C2', 'bass'));
    clavado.push(n(c * 4 + 1, 1, 'E3', 'acomp'));
    clavado.push(n(c * 4 + 2, 1, 'G3', 'acomp'));
    clavado.push(n(c * 4 + 3, 1, 'E3', 'acomp'));
  }
  const avC = Q.detectarMetronomo(clavado, '4/4', 0);
  check('detecta el acompanamiento que repite el mismo ritmo',
    avC.some((i) => /mismo ritmo/.test(i.message)), JSON.stringify(avC.map((i) => i.message)));

  // Bajo solo en el tiempo 1: el otro sintoma clasico.
  const soloEnElUno = [];
  for (let c = 0; c < 6; c++) {
    soloEnElUno.push(n(c * 4, 1, 'C2', 'bass'));
    soloEnElUno.push(n(c * 4 + (c % 2 ? 1 : 2), 1, 'E3', 'acomp'));
  }
  check('avisa que el bajo no se mueve',
    Q.detectarMetronomo(soloEnElUno, '4/4', 0).some((i) => /bajo toca solamente/.test(i.message)));

  // Un arreglo con movimiento no tiene que molestar.
  const vivo = [];
  const patrones = [[0, 1.5, 2.5], [0, 1, 2, 3], [0.5, 2], [0, 1.5, 3]];
  for (let c = 0; c < 8; c++) {
    for (const p of patrones[c % 4]) vivo.push(n(c * 4 + p, 0.5, 'E3', 'acomp'));
    vivo.push(n(c * 4 + (c % 3), 1, 'C2', 'bass'));
  }
  check('un arreglo con movimiento no da aviso de metronomo',
    !Q.detectarMetronomo(vivo, '4/4', 0).some((i) => /mismo ritmo/.test(i.message)),
    JSON.stringify(Q.detectarMetronomo(vivo, '4/4', 0).map((i) => i.message)));

  check('con pocos compases no saca conclusiones',
    Q.detectarMetronomo(clavado.slice(0, 8), '4/4', 0).length === 0);
  /* OJO CON ESTAS DOS: antes decian lo contrario.
     La prueba era `sin acompanamiento no dice nada`, y eso NO era una decision: era el
     hueco del control escrito como si fuera lo deseado. Una cancion sin capa de fondo
     es el peor caso posible —la app toca solo el metronomo y no hay cancion— y era
     justo el unico que pasaba sin un aviso.
     Se descubrio por las malas: once canciones de practica cargadas sin fondo, y ni el
     editor ni las pruebas dijeron nada hasta que alguien las jugo. */
  check('sin NADA de fondo avisa que va a sonar a metronomo',
    Q.detectarMetronomo([], '4/4', 0).some((i) => /no tiene capa de FONDO/.test(i.message)));

  check('con melodia pero sin bajo ni relleno tambien avisa',
    Q.detectarMetronomo(clavado.map((x) => ({ ...x, v: 'lead' })), '4/4', 0)
      .some((i) => /no tiene bajo ni acompanamiento|no tiene bajo/.test(i.message)));
}

/* ===================================================================
   Herramientas de estructura.

   El bug que las trajo hasta aca: "Repetir todo x 2" copiaba solo la capa
   que toca el alumno, asi que la segunda vuelta quedaba en silencio.
   =================================================================== */
console.log('\n=== Repetir y duplicar mueven TODAS las capas ===');
{
  const E = require('./build/estructura.js');
  const ev = (ts) => ts.map((t) => ({ t, dur: 1 }));

  // --- bloque de repeticion ---
  check('sin anacrusa, redondea al compas entero', E.bloqueDeRepeticion(14, 0, 4) === 16);
  check('lo que ya cierra en compases no se estira', E.bloqueDeRepeticion(16, 0, 4) === 16);
  check('con anacrusa se cuenta DESDE la alzada', E.bloqueDeRepeticion(10, 1, 3) === 10);
  check('y no desde cero (que daria 12)', E.bloqueDeRepeticion(10, 1, 3) !== 12);
  check('un largo menor que la anacrusa no se rompe', E.bloqueDeRepeticion(0.5, 1, 4) === 4);

  // --- repetir ---
  const base = ev([0, 4, 8, 12]);
  const dos = E.repetir(base, 2, 16);
  check('repetir x2 duplica la cantidad', dos.length === 8);
  check('la segunda vuelta arranca en el bloque', dos[4].t === 16);
  check('y termina donde corresponde', dos[7].t === 28);
  check('repetir x3 triplica', E.repetir(base, 3, 16).length === 12);
  check('repetir x1 no toca nada', E.repetir(base, 1, 16) === base);
  check('una lista vacia se devuelve igual', E.repetir([], 3, 16).length === 0);

  // LO IMPORTANTE: las dos capas se repiten con el MISMO bloque, asi que
  // siguen alineadas. Antes el fondo no se repetia y quedaba en silencio.
  const jugable = ev([0, 4, 8, 12]);
  const fondo = ev([0, 2, 4, 6, 8, 10, 12, 14]);
  const largo = Math.max(16, 16);
  const bloque = E.bloqueDeRepeticion(largo, 0, 4);
  const j2 = E.repetir(jugable, 2, bloque);
  const f2 = E.repetir(fondo, 2, bloque);
  check('la segunda vuelta del fondo existe', f2.length === 16);
  check('y arranca junto con la del ejercicio', f2[8].t === j2[4].t);
  check('el fondo cubre toda la segunda vuelta',
    Math.max(...f2.map((e) => e.t)) >= Math.max(...j2.map((e) => e.t)));

  // Si el fondo es MAS largo que lo jugable, el bloque tiene que salir de el:
  // medirlo sobre lo jugable hacia que cada vuelta pisara el final de la anterior.
  const bloqueCorto = E.bloqueDeRepeticion(16, 0, 4);
  const bloqueReal = E.bloqueDeRepeticion(Math.max(16, 24), 0, 4);
  check('el bloque sale de la capa mas larga', bloqueReal === 24 && bloqueCorto === 16);
  check('con el bloque corto la segunda vuelta pisaria el final',
    E.repetir(ev([0, 20]), 2, bloqueCorto)[2].t < 24);

  // --- duplicar compas ---
  const cuatro = ev([0, 4, 8, 12]);
  const dup = E.duplicarCompas(cuatro, 4, 4);
  check('duplicar un compas agrega un evento', dup.length === 5);
  check('lo que venia despues se corre un compas',
    dup.filter((e) => e.t === 12).length === 1 && dup.some((e) => e.t === 16));
  check('la copia queda justo despues del original', dup.filter((e) => e.t === 8).length === 1);
  const dupPrimero = E.duplicarCompas(cuatro, 0, 4);
  check('duplicar el primero corre todo lo demas', dupPrimero.some((e) => e.t === 16));
  check('duplicar un compas vacio no agrega nada', E.duplicarCompas(cuatro, 100, 4).length === 4);

  // --- donde empieza cada compas ---
  check('sin anacrusa el compas 1 empieza en 0', E.inicioDelCompas(1, 0, 4) === 0);
  check('con anacrusa el compas 1 empieza despues de la alzada', E.inicioDelCompas(1, 1, 3) === 1);
  check('el compas 3 con alzada', E.inicioDelCompas(3, 1, 3) === 7);
}

console.log('\n=== Ida y vuelta (exportar y volver a leer) ===');
const texto = N.toNotation(r5.chordEvents, 4);
console.log('        exportado:', texto);
const r9 = N.parseNotation(texto, { target: 'chords', beatsPerBar: 4, knownChords: ['C', 'Am', 'F', 'G'] });
check('mismos eventos al volver', JSON.stringify(r9.chordEvents) === JSON.stringify(r5.chordEvents),
  JSON.stringify(r9.chordEvents));

const textoB = N.toNotation(r1.backingEvents, 3);
console.log('        fondo exportado:', textoB);
const r10 = N.parseNotation(textoB, { target: 'backing', beatsPerBar: 3, knownChords: [] });
check('el fondo también vuelve igual', JSON.stringify(r10.backingEvents) === JSON.stringify(r1.backingEvents),
  JSON.stringify(r10.backingEvents));

/* =====================================================================
   LIGADURA — que algo dure más de lo que queda del compás

   Sin esto había que elegir entre cortar el acorde en la barra de compás
   (y el alumno vuelve a rasguear donde la canción sostiene) o poner un
   silencio (y se apaga antes). Es el bug del final de Estrellita.
   ===================================================================== */
console.log('\n=== Ligadura ===');
{
  const KC = ['C', 'Am', 'F', 'G'];
  const lig = N.parseNotation('| F/3 | ~/3 | C/3 |', { target: 'chords', beatsPerBar: 3, knownChords: KC });
  check('la ligadura alarga el rasgueo en vez de agregar otro', lig.chordEvents.length === 2,
    JSON.stringify(lig.chordEvents));
  check('el rasgueo ligado dura los seis tiempos',
    lig.chordEvents[0].dur === 6 && lig.chordEvents[0].t === 0, JSON.stringify(lig.chordEvents));
  check('lo que sigue arranca donde corresponde', lig.chordEvents[1].t === 6);
  check('el compás de la ligadura suma bien y no da error',
    !lig.issues.some((i) => i.level === 'error'), JSON.stringify(lig.issues.map((i) => i.message)));

  // Sin la ligadura, ese mismo acorde de 6 tiempos hace estallar el compás.
  const sinLig = N.parseNotation('| F/6 | C/3 |', { target: 'chords', beatsPerBar: 3, knownChords: KC });
  check('escribirlo sin ligadura sí rompe el compás',
    sinLig.issues.some((i) => i.level === 'error' && /suma 6/.test(i.message)),
    JSON.stringify(sinLig.issues.map((i) => i.message)));

  // En el fondo tiene que alargar TODAS las notas del acorde, no solo la última.
  const ligPoli = N.parseNotation('| [C3,E3,G3]/3 | ~/3 |', { target: 'backing', beatsPerBar: 3, knownChords: [] });
  check('la ligadura alarga las tres notas de un bloque',
    ligPoli.backingEvents.length === 3 && ligPoli.backingEvents.every((e) => e.dur === 6),
    JSON.stringify(ligPoli.backingEvents));

  // Un silencio corta la ligadura: atar por encima uniría dos notas separadas.
  const trasSilencio = N.parseNotation('| C4/1 r/1 ~/1 |', { target: 'backing', beatsPerBar: 3, knownChords: [] });
  check('una ligadura después de un silencio avisa en vez de atar de más',
    trasSilencio.issues.some((i) => i.level === 'error' && /ligadura/.test(i.message)),
    JSON.stringify(trasSilencio.issues.map((i) => i.message)));
  check('y no alarga la nota de antes del silencio',
    trasSilencio.backingEvents.length === 1 && trasSilencio.backingEvents[0].dur === 1,
    JSON.stringify(trasSilencio.backingEvents));

  const sinNada = N.parseNotation('| ~/3 |', { target: 'chords', beatsPerBar: 3, knownChords: KC });
  check('una ligadura sin nada antes avisa', sinNada.issues.some((i) => i.level === 'error'));

  /* La ida y vuelta con acordes sostenidos NO cerraba: `toNotation` escribía el
     evento largo entero y corría la barra de compás, y ese texto ya no se podía
     volver a leer. Ahora lo parte con ligaduras. */
  const largo = [{ t: 0, chord: 'F', dur: 6, dir: 'd' }, { t: 6, chord: 'C', dur: 3, dir: 'd' }];
  const exportado = N.toNotation(largo, 3);
  console.log('        con ligadura:', exportado);
  check('al exportar, lo que cruza el compás sale con ligadura', /~\//.test(exportado), exportado);
  const vuelta = N.parseNotation(exportado, { target: 'chords', beatsPerBar: 3, knownChords: KC });
  check('y vuelve a leerse igual, sin errores de compás',
    JSON.stringify(vuelta.chordEvents) === JSON.stringify(largo) && !vuelta.issues.some((i) => i.level === 'error'),
    JSON.stringify(vuelta.chordEvents) + ' ' + JSON.stringify(vuelta.issues.map((i) => i.message)));
}

/* =====================================================================
   RASGUEO MECÁNICO — el metrónomo, pero en la capa que toca el alumno
   ===================================================================== */
console.log('\n=== Rasgueo mecánico ===');
{
  const Q = require('./build/calidad.js');
  const parejo = Array.from({ length: 12 }, (_, i) => ({ t: i, chord: 'C', dur: 1, dir: 'd' }));
  check('doce golpes todos de un tiempo avisan',
    Q.detectarRasgueoMecanico(parejo, []).some((i) => /metrónomo/.test(i.message)),
    JSON.stringify(Q.detectarRasgueoMecanico(parejo, []).map((i) => i.message)));

  // Con la melodía delante, el aviso tiene que señalar DÓNDE molesta.
  const sostiene = [{ t: 10, dur: 2, midi: 60 }];
  const conMelodia = Q.detectarRasgueoMecanico(parejo, sostiene);
  check('el aviso señala el tiempo donde la melodía sostiene',
    conMelodia.some((i) => /tiempo 10/.test(i.message)),
    JSON.stringify(conMelodia.map((i) => i.message)));

  // Lo que arregla el problema es que las duraciones dejen de ser todas iguales.
  const conRespiro = [...parejo.slice(0, 10), { t: 10, chord: 'C', dur: 2, dir: 'd' }];
  check('con un solo golpe sostenido ya no avisa',
    Q.detectarRasgueoMecanico(conRespiro, []).length === 0,
    JSON.stringify(Q.detectarRasgueoMecanico(conRespiro, []).map((i) => i.message)));

  check('pocos golpes iguales no alcanzan para concluir nada',
    Q.detectarRasgueoMecanico(parejo.slice(0, 6), []).length === 0);

  // Un rasgueo denso NO es el problema: el problema es que sea parejo.
  const denso = Array.from({ length: 16 }, (_, i) => ({ t: i * 0.5, chord: 'C', dur: 0.5, dir: 'd' }));
  check('un rasgueo denso pero parejo también avisa',
    Q.detectarRasgueoMecanico(denso, []).length === 1);
}

console.log('\n' + (fails === 0 ? '✓ TODO BIEN' : '✗ ' + fails + ' FALLAS'));
process.exit(fails === 0 ? 0 : 1);
