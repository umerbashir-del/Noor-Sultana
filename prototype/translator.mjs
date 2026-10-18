const phrases = [
 { id: 'baggage', english: 'Where is baggage claim?', pattern: /^(?:where is baggage claim|where baggage claim is|where do i collect my (?:bags|luggage))$/, ja: ['手荷物受取所はどこですか？', 'Tenimotsu uketorijo wa doko desu ka?'], es: ['¿Dónde está la recogida de equipajes?', 'DOHN-deh ehs-TAH lah reh-koh-HEE-dah deh eh-kee-PAH-hehs'] },
 { id: 'toilets', english: 'Where are the toilets?', pattern: /^(?:where (?:are|is) (?:the )?(?:toilets?|restrooms?|bathrooms?)|where (?:the )?(?:toilets?|restrooms?|bathrooms?) (?:are|is))$/, ja: ['トイレはどこですか？', 'Toire wa doko desu ka?'], es: ['¿Dónde están los baños?', 'DOHN-deh ehs-TAHN lohs BAH-nyohs'] },
 { id: 'gate', english: 'Where is my boarding gate?', pattern: /^(?:where is my (?:boarding )?gate|where my (?:boarding )?gate is)$/, ja: ['搭乗口はどこですか？', 'Tojoguchi wa doko desu ka?'], es: ['¿Dónde está mi puerta de embarque?', 'DOHN-deh ehs-TAH mee PWEHR-tah deh ehm-BAR-keh'] },
 { id: 'help', english: 'Could you help me, please?', pattern: /^(?:(?:could|can) you help me(?: please)?|i need help)$/, ja: ['手伝っていただけますか？', 'Tetsudatte itadakemasu ka?'], es: ['¿Puede ayudarme, por favor?', 'PWEH-deh ah-yoo-DAR-meh por fah-VOR'] },
 { id: 'water', english: 'Could I have some water, please?', pattern: /^(?:(?:could|can|may) i have (?:some )?water(?: please)?|water please)$/, ja: ['お水をいただけますか？', 'Omizu o itadakemasu ka?'], es: ['¿Me puede dar agua, por favor?', 'meh PWEH-deh dar AH-gwah por fah-VOR'] },
 { id: 'vegetarian', english: 'Do you have a vegetarian meal?', pattern: /^(?:do you have (?:a )?vegetarian (?:meal|food)|is (?:a )?vegetarian meal available)$/, ja: ['ベジタリアン用の食事はありますか？', 'Bejitarian-yo no shokuji wa arimasu ka?'], es: ['¿Tiene una comida vegetariana?', 'TYEH-neh OO-nah koh-MEE-dah beh-heh-tah-RYAH-nah'] },
];
export function translationIntent(message) {
 return /\b(translat\w*|how (?:do|can) i (?:say|ask)|travel phrases?|phrase translator)\b/i.test(message)
  || /\b(?:in|into) (?:japanese|spanish)\b/i.test(message);
}
export function translationReply(message, selectedLanguage = 'japanese') {
 const base = { expression: 'thoughtful', sourceLabel: 'Demo travel phrasebook · Fixed phrases · Read-only' };
 const languageMatch = message.match(/\b(?:in|into|to)\s+([a-z]+)(?:\s+please)?[?.!]*\s*$/i)
  || message.match(/^\s*translate\s+(?:into|to)\s+([a-z]+)\s*:/i);
 const requestedLanguage = languageMatch?.[1] || selectedLanguage;
 const language = typeof requestedLanguage === 'string' ? requestedLanguage.toLowerCase() : '';
 if (!['japanese','spanish'].includes(language)) return { ...base, reply: 'This demo phrasebook supports Japanese and Spanish only. Select one of those languages; I have not translated the requested phrase.' };
 let text = message.toLowerCase().trim()
  .replace(/^translate\s+(?:into|to)\s+[a-z]+\s*:\s*/i, '')
  .replace(/^(?:how (?:do|can) i (?:say|ask)|translate)\s*/i, '')
  .replace(/\s+(?:in|into|to)\s+(?:japanese|spanish)(?:\s+please)?[?.!]*\s*$/i, '')
  .replace(/[“”"'‘’?¿!.,]/g, '').replace(/\s+/g, ' ').trim();
 const phrase = phrases.find((p) => p.pattern.test(text));
 if (!phrase) return { ...base, reply: 'Choose one supported travel phrase: baggage claim, toilets, boarding gate, asking for help, requesting water, or asking for a vegetarian meal. This fixed phrasebook does not translate arbitrary text or unrelated questions.' };
 const code = language === 'japanese' ? 'ja' : 'es';
 const [translated, pronunciation] = phrase[code];
 return { ...base, reply: `${phrase.english} In ${language === 'japanese' ? 'Japanese' : 'Spanish'}: ${translated} Pronunciation (approximate): ${pronunciation}`,
 translation: { english: phrase.english, text: translated, pronunciation, language, code } };
}
