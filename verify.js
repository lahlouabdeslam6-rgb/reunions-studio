'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const nlp = require('./nlp');
const {analyze} = require('./server');

test('la démonstration conserve la décision et les champs inconnus', () => {
  const segments = nlp.segment(nlp.example);
  const report = nlp.analyzeRules(segments);
  assert.equal(segments[2].horodatage,'00:18');
  assert.deepEqual(report.decisions.map(row=>row.segments),[[2]]);
  assert.deepEqual(report.actions.map(row=>[row.responsable,row.echeance]),[['Nadia','lundi'],[null,null]]);
  assert.deepEqual(report.points_a_confirmer.map(row=>row.segments),[[1]]);
});
test('une contradiction reste ouverte jusqu’à une correction explicite', () => {
  const text = 'On valide la livraison pour mardi.\nOn valide la livraison pour jeudi.';
  const conflict = nlp.analyzeRules(nlp.segment(text));
  assert.equal(conflict.decisions.length,0);
  assert.deepEqual(conflict.points_a_confirmer[0].segments,[1,2]);
  const corrected = nlp.analyzeRules(nlp.segment(`${text}\nFinalement, on valide la livraison pour lundi.`));
  assert.deepEqual(corrected.decisions[0].segments,[3]);
  assert.equal(corrected.points_a_confirmer.length,0);
});
test('entrée vide et référence hors transcript sont rejetées', () => {
  assert.throws(()=>nlp.segment(' '),/Ajoutez/);
  const segments = nlp.segment(nlp.example);
  const report = nlp.analyzeRules(segments);
  report.actions[0].segments = [99];
  assert.throws(()=>nlp.checkResult(report,segments),/Référence source/);
});
test('le contrat Ollama structure les données et filtre les champs sans preuve',async () => {
  const expected = nlp.analyzeRules(nlp.segment(nlp.example));
  expected.actions[0].responsable = 'Alex';
  expected.resume = [{texte:'Décisions confirmées',segments:[2]}];
  const report = await analyze(nlp.example,async (url,options) => {
    const body = JSON.parse(options.body);
    assert.match(url,/127\.0\.0\.1:11434\/api\/chat/);
    assert.equal(body.model,'qwen2.5:7b');
    assert.ok(body.format.properties.actions);
    assert.ok(JSON.parse(body.messages[1].content).length === 5);
    return {ok:true,status:200,json:async () => ({message:{content:JSON.stringify(expected)}})};
  });
  assert.equal(report.actions[0].responsable,null);
  assert.equal(report.actions[0].echeance,'lundi');
  assert.equal(report.resume[0].texte,'La maquette est prête');
});
test('Ollama indisponible produit un message exploitable',async () => {
  await assert.rejects(analyze(nlp.example,async()=>{throw new Error('connection');}),/Connexion à Ollama impossible/);
});
