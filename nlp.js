(function (root) {
  "use strict";
  const example = `[00:04] Lina : On pourrait livrer vendredi.
[00:11] Lina : On valide la livraison pour lundi.
[00:18] Lina : Nadia, prépare la démonstration pour lundi.
[00:24] Sami : Il faut aussi revoir les tests.
[00:31] Lina : La maquette est prête.`;
  const keys = ['resume', 'decisions', 'actions', 'points_a_confirmer'];
  const maxInput = 50000;
  const item = (properties) => ({type:'object', additionalProperties:false, properties,
    required:Object.keys(properties)});
  const str = {type:'string'};
  const nullable = {type:['string','null']};
  const ids = {type:'array', items:{type:'integer'}, minItems:1};
  const statement = item({texte:str, segments:ids});
  const schema = item({resume:{type:'array',items:statement}, decisions:{type:'array',items:statement},
    actions:{type:'array',items:item({texte:str, responsable:nullable, echeance:nullable, segments:ids})},
    points_a_confirmer:{type:'array',items:statement}});

  function segment(input) {
    if (typeof input !== 'string' || !input.trim()) throw new Error('Ajoutez une transcription.');
    if (input.length > maxInput) throw new Error('La transcription dépasse 50 000 caractères. Séparez-la par sujets.');
    return input.trim().split(/\r?\n+/).flatMap(line => {
      const clean = line.trim();
      if (!clean) return [];
      const time = clean.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*/);
      const untimed = time ? clean.slice(time[0].length) : clean;
      const speaker = untimed.match(/^([\p{L}][\p{L} .’'-]{0,39})\s*:\s+/u);
      const speech = speaker ? untimed.slice(speaker[0].length) : untimed;
      return speech.split(/(?<=[.!?;])\s+(?=[«“"\p{Lu}])/u).map(texte => ({texte,
        locuteur:speaker ? speaker[1].trim() : null, horodatage:time ? time[1] : null}));
    }).map((s,i) => ({id:i+1,...s}));
  }

  const deadline = /\s+(?:pour|avant|d’ici|d'ici|au plus tard)\s+((?:le\s+)?(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?:\s+prochain)?|(?:le\s+)?\d{1,2}[/.\-]\d{1,2}(?:[/.\-]\d{2,4})?|demain|ce soir|la semaine prochaine|fin de semaine)\s*$/i;
  const trim = value => value.trim().replace(/[.!?;]+$/, '').trim();
  function extractDate(text) {
    const match = trim(text).match(deadline);
    return match ? [trim(text).slice(0,match.index), match[1]] : [trim(text),null];
  }
  const negative = /\b(?:on ne|nous ne|pas valid[ée]|pas confirm[ée]|non valid[ée]|non confirm[ée]|annul[ée]\w*)\b/i;
  const proposal = /\b(?:pourrait|propose|envisage|faudrait|pourrions|si on|à discuter|à confirmer)\b/i;
  const committed = /^(?:(?:finalement|donc)[, ]+)?(?:(?:on|nous)\s+(?:a\s+)?(?:valide[é]?|validons|confirme|confirmons|décide|décidons|retient|retenons)|(?:décision|validé)\s*:)\s*/i;
  const obligation = /^(?:il faut(?:\s+aussi)?|merci de)\s+/i;
  const person = /^([\p{Lu}][\p{L}’-]+(?:\s+[\p{Lu}][\p{L}’-]+)?)[,:]\s+/u;
  const assign = /^(?:tu\s+)?(?:prépare|envoie|vérifie|corrige|teste|rédige|présente|termine|partage|fais|contacte|mets|livre|revois|finalise|complète|organise|analyse|crée|déploie|planifie)\b/i;
  const revision = /^(?:finalement|correction|nouvelle décision|on remplace)\b/i;
  const normalize = value => value.toLowerCase().replace(/[’']/g,' ').replace(/^(?:de\s+|le\s+|la\s+|les\s+|l\s+)+/, '').replace(/[^\p{L}\p{N}]+/gu,' ').trim();

  function analyzeRules(segments) {
    const result = Object.fromEntries(keys.map(k => [k,[]]));
    const decisions = new Map();
    const conflicted = new Map();
    const seen = new Set();
    for (const {id,texte,locuteur} of segments) {
      const exact = trim(texte);
      if (!exact || seen.has(normalize(exact))) continue;
      seen.add(normalize(exact));
      const source = {texte:exact,segments:[id]};
      if (texte.endsWith('?') || proposal.test(exact) || negative.test(exact)) {
        result.points_a_confirmer.push(source);
        continue;
      }
      if (committed.test(exact)) {
        const [subject,date] = extractDate(exact.replace(committed,''));
        const key = normalize(subject);
        if (!key) { result.points_a_confirmer.push(source); continue; }
        const previous = decisions.get(key);
        const conflict = conflicted.get(key);
        if (revision.test(exact)) {
          if (conflict) result.points_a_confirmer = result.points_a_confirmer.filter(row => row !== conflict);
          conflicted.delete(key);
          decisions.set(key,{source,date});
        } else if (conflict) {
          conflict.texte += ` / ${exact}`;
          conflict.segments.push(id);
        } else if (previous && previous.date && date && normalize(previous.date) !== normalize(date)) {
          const issue = {texte:`Échéances contradictoires : ${previous.source.texte} / ${exact}`,segments:[...previous.source.segments,id]};
          result.points_a_confirmer.push(issue);
          decisions.delete(key);
          conflicted.set(key,issue);
        } else if (!previous || date) {
          decisions.set(key,{source,date});
        }
        continue;
      }
      const named = exact.match(person);
      const self = exact.match(/^je\s+(?:vais|m’engage à|m'engage à)\s+/i);
      let action = null;
      let owner = null;
      if (obligation.test(exact)) action = exact.replace(obligation,'');
      if (named && assign.test(exact.slice(named[0].length))) { action = exact.slice(named[0].length); owner = named[1]; }
      if (self) { action = exact.slice(self[0].length); owner = locuteur; }
      if (action) {
        const [task,due] = extractDate(action.replace(/^tu\s+/i,''));
        if (task) result.actions.push({texte:task,responsable:owner,echeance:due,segments:[id]});
      } else if (result.resume.length < 5) result.resume.push(source);
    }
    result.decisions = Array.from(decisions.values(), entry => entry.source);
    if (!result.resume.length) result.resume.push(...[...result.decisions,...result.actions].slice(0,4).map(({texte,segments}) => ({texte,segments})));
    return result;
  }

  function checkResult(raw, segments) {
    if (!raw || typeof raw !== 'object') throw new Error('Résultat illisible.');
    const index = new Map(segments.map(s => [s.id,s]));
    return Object.fromEntries(keys.map(key => {
      if (!Array.isArray(raw[key])) throw new Error('Rubrique manquante dans la réponse.');
      return [key,raw[key].map(row => {
        if (!row || typeof row.texte !== 'string' || !row.texte.trim() || !Array.isArray(row.segments) || !row.segments.length ||
          !row.segments.every(id => Number.isInteger(id) && index.has(id))) throw new Error('Référence source invalide dans la réponse.');
        const clean = {texte:row.texte.trim(),segments:[...new Set(row.segments)]};
        if (key === 'actions') {
          const evidence = clean.segments.map(id => `${index.get(id).locuteur || ''} ${index.get(id).texte}`).join(' ');
          for (const field of ['responsable','echeance']) {
            if (row[field] !== null && typeof row[field] !== 'string') throw new Error('Champ action invalide.');
            clean[field] = row[field]?.trim() && normalize(evidence).includes(normalize(row[field])) ? row[field].trim() : null;
          }
        }
        return clean;
      })];
    }));
  }

  const lib = {example,maxInput,keys,schema,segment,analyzeRules,checkResult};
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.ReunionNLP = lib;
})(globalThis);
