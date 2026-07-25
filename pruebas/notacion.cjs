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
  check('usa Feliz cumpleaños como ejemplo', /Feliz cumplea/.test(pn) && /G4\/\.5 G4\/\.5/.test(pn));
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
check('NO le dice "un acorde por compás"', !/un acorde por comp[aá]s ya est[aá] bien/i.test(p1));
check('le pide el ritmo armónico real', /cambian de acorde en la mitad del comp/i.test(p1));
check('le prohíbe estirar para redondear', /no estires ni repitas/i.test(p1));
check('le pide que declare BPM y compás', /BPM: <n/.test(p1) && /COMPAS: </.test(p1));
check('el ejemplo muestra un cambio a mitad de compás', /F\/2 C\/2/.test(p1));

const p2 = P.buildAiPrompt({ ...base, melodiaDelNivel: 'C4/1 C4/1 G4/1 G4/1 | A4/1 A4/1 G4/2' });
check('incluye la melodía del nivel cuando la hay', /armoniz[aá] exactamente esta/i.test(p2) && /C4\/1 C4\/1 G4\/1/.test(p2));
check('sin melodía no la menciona', !/armoniz[aá] exactamente esta/i.test(p1));

const p3 = P.buildAiPrompt({ ...base, imponerMedida: true });
check('con medida impuesta sí fija los compases', /Extensi[oó]n: 8 compases/.test(p3));
check('con medida impuesta no pide la cabecera', !/BPM: <n/.test(p3));

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

console.log('\n' + (fails === 0 ? '✓ TODO BIEN' : '✗ ' + fails + ' FALLAS'));
process.exit(fails === 0 ? 0 : 1);
