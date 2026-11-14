'use strict';
/* G.O.C Academy Hub — public preview question pool (Stage 10).
 *
 * Fifteen ORIGINAL questions written for the anonymous homepage preview,
 * in JAMB style and checked against the standard UTME syllabus topics
 * they sample. They are sample questions for a five-question taster:
 * they are not official JAMB questions, they carry no bank id, and no
 * code path connects this pool to the official JAMB, Objective, Web
 * Test, Free UTME weekly or Free UTME competition banks — in either
 * direction. The public routes in server.js draw five at random per
 * attempt and hold the answers server-side until submission.
 */
module.exports = [
  { id: 'demo-eng-1', subject: 'Use of English', topic: 'Synonyms',
    text: 'Choose the option nearest in meaning to the word in bold: The principal gave a **candid** response to the question.',
    options: ['evasive', 'frank', 'rude', 'lengthy'], answer: 1,
    explanation: '“Candid” means frank and honest, so “frank” is nearest in meaning.' },
  { id: 'demo-eng-2', subject: 'Use of English', topic: 'Concord',
    text: 'Choose the option that best completes the sentence: The committee ___ submitted its report to the board.',
    options: ['have', 'are', 'has', 'were'], answer: 2,
    explanation: '“Committee” is treated as one unit here (“its report”), so the singular verb “has” agrees with it.' },
  { id: 'demo-eng-3', subject: 'Use of English', topic: 'Antonyms',
    text: 'Choose the option opposite in meaning to the word in bold: Clean water is **scarce** in the village.',
    options: ['costly', 'plentiful', 'hidden', 'polluted'], answer: 1,
    explanation: '“Scarce” means in short supply; its opposite here is “plentiful”.' },
  { id: 'demo-bio-1', subject: 'Biology', topic: 'Photosynthesis',
    text: 'Photosynthesis in a green leaf takes place mainly in the',
    options: ['root hairs', 'chloroplasts', 'nucleus', 'vacuoles'], answer: 1,
    explanation: 'Chloroplasts contain chlorophyll, the pigment that traps light energy for photosynthesis.' },
  { id: 'demo-bio-2', subject: 'Biology', topic: 'Transport in plants',
    text: 'Osmosis is best described as the movement of water molecules from',
    options: ['a concentrated solution to a dilute solution through any membrane', 'a region of higher water potential to a region of lower water potential through a selectively permeable membrane', 'a region of lower water potential to a region of higher water potential', 'one cell to another only through the xylem'], answer: 1,
    explanation: 'Osmosis is the net movement of water from higher to lower water potential across a selectively permeable membrane.' },
  { id: 'demo-bio-3', subject: 'Biology', topic: 'Heredity',
    text: 'The unit of heredity that controls a particular characteristic is the',
    options: ['chromosome', 'gene', 'gamete', 'zygote'], answer: 1,
    explanation: 'A gene is the unit of heredity controlling a characteristic; genes are carried on chromosomes.' },
  { id: 'demo-chem-1', subject: 'Chemistry', topic: 'Acids and bases',
    text: 'A solution with a pH of 3 is',
    options: ['neutral', 'weakly alkaline', 'acidic', 'a salt solution'], answer: 2,
    explanation: 'The pH scale runs 0–14; values below 7 are acidic, and 3 is strongly acidic.' },
  { id: 'demo-chem-2', subject: 'Chemistry', topic: 'Atomic structure',
    text: 'The atomic number of an element is the number of',
    options: ['neutrons in the nucleus', 'protons in the nucleus', 'electrons in the outermost shell only', 'protons and neutrons together'], answer: 1,
    explanation: 'Atomic number = number of protons, which also defines which element it is.' },
  { id: 'demo-chem-3', subject: 'Chemistry', topic: 'Formulae',
    text: 'The chemical formula of common salt is',
    options: ['KCl', 'NaOH', 'NaCl', 'CaCl₂'], answer: 2,
    explanation: 'Common salt is sodium chloride, NaCl.' },
  { id: 'demo-phy-1', subject: 'Physics', topic: 'Units',
    text: 'The SI unit of force is the',
    options: ['joule', 'newton', 'pascal', 'watt'], answer: 1,
    explanation: 'Force is measured in newtons (N); joules measure energy and watts measure power.' },
  { id: 'demo-phy-2', subject: 'Physics', topic: 'Electricity',
    text: 'A resistor of resistance R is connected across a 12 V battery and carries a current of 3 A. The value of R is',
    options: ['0.25 Ω', '4 Ω', '9 Ω', '36 Ω'], answer: 1,
    explanation: 'Ohm\u2019s law: R = V/I = 12/3 = 4 Ω.' },
  { id: 'demo-phy-3', subject: 'Physics', topic: 'Motion',
    text: 'The unit of acceleration is',
    options: ['m/s', 'm/s²', 'kg/m', 'N/m'], answer: 1,
    explanation: 'Acceleration is change of velocity (m/s) per second, giving m/s².' },
  { id: 'demo-math-1', subject: 'Mathematics', topic: 'Linear equations',
    text: 'If 2x + 6 = 14, the value of x is',
    options: ['3', '4', '5', '10'], answer: 1,
    explanation: '2x = 14 − 6 = 8, so x = 4.' },
  { id: 'demo-math-2', subject: 'Mathematics', topic: 'Probability',
    text: 'A bag contains 3 red and 2 blue balls. One ball is picked at random. The probability that it is red is',
    options: ['2/5', '3/5', '1/3', '3/2'], answer: 1,
    explanation: 'There are 3 red balls out of 5 balls in total, so the probability is 3/5.' },
  { id: 'demo-math-3', subject: 'Mathematics', topic: 'Sequences',
    text: 'The next term in the sequence 2, 5, 8, 11, … is',
    options: ['13', '14', '15', '16'], answer: 1,
    explanation: 'The sequence increases by 3 each time, so the next term is 11 + 3 = 14.' }
];
