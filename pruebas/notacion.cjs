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
const malo = '| C/4 | Am/3 | F/4 |';
const r7 = N.parseNotation(malo, { target: 'chords', beatsPerBar: 4, knownChords: ['C', 'Am', 'F'] });
const aviso = r7.issues.find((i) => /compás 2/.test(i.message));
check('detecta el compás 2', !!aviso, aviso && aviso.message);

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
