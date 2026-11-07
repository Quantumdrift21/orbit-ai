// Languages the Gemini Live API understands and speaks (99, from Google's Live API docs).
// Native-audio models pick the spoken language themselves, so Orbit steers it with instructions.
export const LANGUAGES = [
  ['af', 'Afrikaans'],
  ['ak', 'Akan'],
  ['sq', 'Albanian'],
  ['am', 'Amharic'],
  ['ar', 'Arabic'],
  ['hy', 'Armenian'],
  ['as', 'Assamese'],
  ['az', 'Azerbaijani'],
  ['eu', 'Basque'],
  ['be', 'Belarusian'],
  ['bn', 'Bengali'],
  ['bs', 'Bosnian'],
  ['bg', 'Bulgarian'],
  ['my', 'Burmese'],
  ['ca', 'Catalan'],
  ['ceb', 'Cebuano'],
  ['zh-Hans', 'Chinese (Simplified)'],
  ['zh-Hant', 'Chinese (Traditional)'],
  ['hr', 'Croatian'],
  ['cs', 'Czech'],
  ['da', 'Danish'],
  ['nl', 'Dutch'],
  ['en', 'English'],
  ['et', 'Estonian'],
  ['fo', 'Faroese'],
  ['fil', 'Filipino'],
  ['fi', 'Finnish'],
  ['fr', 'French'],
  ['gl', 'Galician'],
  ['ka', 'Georgian'],
  ['de', 'German'],
  ['el', 'Greek'],
  ['gu', 'Gujarati'],
  ['ha', 'Hausa'],
  ['he', 'Hebrew'],
  ['hi', 'Hindi'],
  ['hu', 'Hungarian'],
  ['is', 'Icelandic'],
  ['id', 'Indonesian'],
  ['ga', 'Irish'],
  ['it', 'Italian'],
  ['ja', 'Japanese'],
  ['kn', 'Kannada'],
  ['kk', 'Kazakh'],
  ['km', 'Khmer'],
  ['rw', 'Kinyarwanda'],
  ['ko', 'Korean'],
  ['ku', 'Kurdish'],
  ['ky', 'Kyrgyz'],
  ['lo', 'Lao'],
  ['lv', 'Latvian'],
  ['lt', 'Lithuanian'],
  ['mk', 'Macedonian'],
  ['ms', 'Malay'],
  ['ml', 'Malayalam'],
  ['mt', 'Maltese'],
  ['mi', 'Maori'],
  ['mr', 'Marathi'],
  ['mn', 'Mongolian'],
  ['ne', 'Nepali'],
  ['no', 'Norwegian'],
  ['or', 'Odia'],
  ['om', 'Oromo'],
  ['ps', 'Pashto'],
  ['fa', 'Persian'],
  ['pl', 'Polish'],
  ['pt-BR', 'Portuguese (Brazil)'],
  ['pt-PT', 'Portuguese (Portugal)'],
  ['pa', 'Punjabi'],
  ['qu', 'Quechua'],
  ['ro', 'Romanian'],
  ['rm', 'Romansh'],
  ['ru', 'Russian'],
  ['sr', 'Serbian'],
  ['sd', 'Sindhi'],
  ['si', 'Sinhala'],
  ['sk', 'Slovak'],
  ['sl', 'Slovenian'],
  ['so', 'Somali'],
  ['st', 'Southern Sotho'],
  ['es', 'Spanish'],
  ['sw', 'Swahili'],
  ['sv', 'Swedish'],
  ['tg', 'Tajik'],
  ['ta', 'Tamil'],
  ['te', 'Telugu'],
  ['th', 'Thai'],
  ['tn', 'Tswana'],
  ['tr', 'Turkish'],
  ['tk', 'Turkmen'],
  ['uk', 'Ukrainian'],
  ['ur', 'Urdu'],
  ['uz', 'Uzbek'],
  ['vi', 'Vietnamese'],
  ['cy', 'Welsh'],
  ['fy', 'Western Frisian'],
  ['wo', 'Wolof'],
  ['yo', 'Yoruba'],
  ['zu', 'Zulu'],
];

const nameOf = (code) => LANGUAGES.find(([c]) => c === code)?.[1];

// Speech recognition sometimes writes a phrase down as a different, similar-sounding language
// (Tamil heard as Hindi, a short word heard as Spanish). So the rules name the languages the
// user really speaks and tell Gemini to treat anything else as a mis-hearing.
const MISHEARD =
  'The transcript of what the user said sometimes looks like a different, similar-sounding language; ' +
  'that is the speech recogniser mis-hearing them, not a real switch.';

const AUTO =
  'LANGUAGE: Reply in the language the user is speaking. ' +
  MISHEARD +
  ' Once the conversation has a language, STAY in it: if a new message is short, mixes in English words, or looks ' +
  'like a related language (for example a Hindi-looking line in a Tamil conversation), it was mis-heard, so reply ' +
  'in the conversation language. Switch only when the user asks you to, or speaks two or more full sentences in ' +
  'the new language. If they mix languages (like Tanglish or Hinglish), reply in the same natural mix.';

/**
 * The system-instruction rule for the user's languages: `main` is 'auto' or a code from LANGUAGES,
 * `second` is an optional second code ('' = none).
 */
export function languageRule(main, second) {
  const a = nameOf(main);
  const b = second && second !== main ? nameOf(second) : undefined;
  if (!a) return AUTO;
  if (!b) {
    return (
      `LANGUAGE: The user speaks ${a}. Always reply in natural spoken ${a} only. ${MISHEARD} ` +
      `Even if their words look like another language, reply in ${a}. Keep common English technical words as they are.`
    );
  }
  return (
    `LANGUAGE: The user speaks ${a} and ${b}, sometimes mixed. Reply in whichever of the two they used; if they ` +
    `mixed them, reply in natural ${a} with common ${b} words. ${MISHEARD} Never reply in any language other than ` +
    `${a} or ${b}: if their words look like another language, reply in ${a}. ` +
    'Keep common English technical words as they are.'
  );
}
