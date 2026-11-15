# Réunions Studio

Assistant de réunion local développé par **Ismail Lahlou**. À partir d’un enregistrement ou d’une transcription Meetily, il prépare un résumé, liste les décisions et extrait les actions avec leurs responsables et leurs échéances.

![Interface de Réunions Studio](docs/interface.png)

## Ce que j’ai développé

- Import audio et transcription locale avec Faster Whisper. Le texte horodaté s’affiche progressivement et reste modifiable.
- Compte rendu structuré avec un mode rapide par règles et un mode d’IA locale avec Qwen via Ollama.
- Historique des décisions qui distingue une date proposée, la date finalement validée et les validations contradictoires. Chaque repère ouvre l’extrait audio correspondant, avec arrêt automatique en fin de segment.
- Import des transcriptions Meetily via SQLite en lecture seule, correction manuelle, validation et export Markdown ou JSON.

Meetily Community sait déjà enregistrer, transcrire et résumer une réunion. Réunions Studio fonctionne à côté de Meetily et se concentre sur le suivi des changements, la vérification par extrait et la validation des actions. Le parcours a été vérifié sur un WAV de démonstration en français. L’import a été testé avec une base compatible de test.

**Stack** · Python, Faster Whisper, Node.js, JavaScript, SQLite, Ollama et Qwen2.5.

## Démarrer

1. Sous Windows, extrayez le ZIP. Installez Node.js 20+ et Python 3.11 ou 3.12 si aucun moteur correspondant n’est disponible. Le lanceur détecte aussi les outils livrés avec Codex.
2. Exécutez `Installer_audio.cmd` une fois pour récupérer Faster Whisper et le modèle multilingue Whisper Base (~145 Mo pour le modèle). L’audio reste local après installation.
3. Exécutez `Lancer_Studio.cmd` et utilisez `http://127.0.0.1:8465`. Choisissez un fichier MP3, WAV, M4A, WebM, OGG ou FLAC de 100 Mo maximum, ou chargez l’exemple audio synthétique en français.
4. Cliquez sur **Transcrire l’audio**. Corrigez le texte si nécessaire, puis cliquez sur **Analyser la réunion**. Le mode à règles est immédiat. Pour **IA locale · Qwen**, Ollama doit fonctionner et `ollama list` doit contenir `qwen2.5:7b`.
5. Consultez les décisions, les tâches et leurs preuves. Cliquez sur un repère horaire pour écouter uniquement le passage correspondant. La lecture s’arrête à la fin du segment. Relisez avant de valider et d’exporter.

## Historique des décisions

Pour les sujets reconnus (livraison, démonstration, tests, budget et publication), les dates différentes sont affichées dans l’ordre. Une validation après une proposition retient sa date. Plusieurs validations incompatibles restent à vérifier, sauf correction explicite. Ce regroupement heuristique fonctionne sur des formulations explicites en français. Il exige une relecture si plusieurs décisions distinctes abordent le même sujet.

## Raccordement à Meetily

Le bouton **Importer depuis Meetily** détecte `meeting_minutes.sqlite` dans les dossiers locaux de Meetily. Il affiche les réunions et ouvre les segments choisis, sans copier-coller, via une connexion SQLite en lecture seule. Si nécessaire, indiquez le chemin exact en définissant `MEETILY_DB` avant de lancer `node server.js`. Le raccordement utilise le schéma public de Meetily Community. Pour utiliser le lecteur et les liens audio, ouvrez l’enregistrement d’origine dans Réunions Studio et lancez sa transcription.

Le système utilise un seul moteur audio à la fois. Whisper Base est multilingue. L’exactitude varie selon la langue, la qualité audio et les échanges simultanés. Corrigez le texte avant d’analyser. Les règles d’analyse ciblent les réunions en français.

## Références

- [Meetily Community Edition](https://github.com/Zackriya-Solutions/meetily)
- [Stockage des réunions et transcriptions Meetily](https://github.com/Zackriya-Solutions/meetily/blob/main/frontend/src-tauri/src/database/repositories/meeting.rs)
- [Faster Whisper](https://github.com/SYSTRAN/faster-whisper)

## Fond de l’interface

`meeting-wallpaper.png` a été créé avec l’outil ImageGen intégré. Prompt utilisé :

> Photorealistic editorial landscape photograph, a modern glass-walled meeting room with four colleagues seated around a walnut table collaborating, shot from outside room through glass, some silhouetted side profiles and a person gesturing. Architectural photography, cinematic natural dusk, cool deep blue twilight through large windows and warm amber lamp reflections, warm walnut and muted taupe. Wide 16:9 wallpaper composition for a premium glass UI application: major recognizable human activity and glowing practical lamp concentrated in the LEFT third and far right edges, soft lower-contrast space in center-right, enough underlying contrast and details to be visible through translucent frosted cards. Authentic candid workplace photography, refined atmospheric depth, realistic lighting, dark navy shadows, no heavy pre-applied blur. The entire image is JUST the photograph, with no letters, no logos, no screens with readable text, and no UI graphics or glass overlays drawn into the photo.
