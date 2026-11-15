(function (root) {
  'use strict';
  const days = 'lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain';
  const date = new RegExp(`\\b((?:${days})(?:\\s+prochain)?|\\d{1,2}[/.]\\d{1,2}(?:[/.]\\d{2,4})?)\\b`,'i');
  const topic = [
    ['Livraison', /\b(?:livr\w+|mise en production|déploiement)\b/i],
    ['Démonstration', /\b(?:démo(?:nstration)?|présentation)\b/i],
    ['Tests', /\b(?:tests?|recette|validation technique)\b/i],
    ['Budget', /\b(?:budget|financement|devis)\b/i],
    ['Publication', /\b(?:publier|publication|mise en ligne)\b/i]
  ];
  const proposal = /\b(?:pourrait|pourrions|propose|envisage|faudrait|et si)\b/i;
  const confirmation = /\b(?:on|nous)\s+(?:a\s+)?(?:valide[é]?|validons|confirme|confirmons|décide|décidons|retient|retenons|fixe)\b|^décision\s*:/i;
  const correction = /\b(?:finalement|correction|report(?:é|ée|er)|remplace|en fait)\b/i;
  const negation = /\b(?:ne|pas|annul(?:é|ée|er))\b/i;

  function build(segments) {
    const groups = new Map();
    for (const segment of segments) {
      const { id, texte } = segment;
      const match = topic.find(([,pattern]) => pattern.test(texte));
      if (!match || texte.endsWith('?') || negation.test(texte)) continue;
      const type = proposal.test(texte) ? 'Proposition' : confirmation.test(texte) ? 'Validation' : null;
      const deadline = texte.match(date)?.[1].toLowerCase();
      if (!type || !deadline) continue;
      const title = match[0];
      if (!groups.has(title)) groups.set(title,[]);
      const events = groups.get(title);
      events.push({id,type,deadline,correction:correction.test(texte)});
    }
    return Array.from(groups,([title,events]) => {
      const confirmed = events.filter(e => e.type === 'Validation');
      const latestCorrection = confirmed.findLastIndex(e => e.correction);
      const relevant = confirmed.slice(Math.max(0,latestCorrection));
      const conflict = new Set(relevant.map(e => e.deadline)).size > 1;
      const current = !conflict ? relevant.at(-1)?.id : null;
      return {title,events,conflict,current};
    }).filter(group => group.events.length >= 2 && new Set(group.events.map(e => e.deadline)).size > 1);
  }
  if (typeof module === 'object' && module.exports) module.exports = {build};
  else root.DecisionHistory = {build};
})(globalThis);
