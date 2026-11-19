# Réunions Studio

Assistant de réunion développé par **Ismail Lahlou**. Il permet de tenir un appel vidéo avec un lien d’invitation ou d’importer un enregistrement. L’application prépare une transcription horodatée, un résumé, les décisions et les actions à suivre.

![Atelier Réunions Studio](docs/interface.png)

## Ce que j’ai développé

- **Salle vidéo indépendante.** L’hôte ouvre la page `/salle`, invite les participants par lien HTTPS et enregistre l’audio avec leur accord. **Terminer et analyser** ferme la salle, revient à l’atelier et lance le traitement local.
- **Transcription locale.** Faster Whisper affiche progressivement les passages horodatés. La transcription est modifiable avant la validation du compte rendu.
- **Décisions et actions vérifiables.** L’historique suit les dates proposées et validées. Chaque repère audio joue uniquement le passage correspondant. Les actions indiquent les responsables et les échéances disponibles.
- **Deux modes d’analyse.** Règles locales pour une réponse rapide ou Qwen via Ollama. Import de transcriptions Meetily en lecture seule et export Markdown ou JSON après validation.
- **Traduction locale.** Les langues proposées dépendent de la langue du résumé. Pour une réunion FR/EN, l’atelier peut traduire les phrases anglaises détectées ou une sélection de texte.
- **Import TXT et PDF.** Un document contenant du texte peut servir de point de départ pour l’analyse.
- **Historique des réunions.** L’audio, la transcription et le compte rendu sont sauvegardés automatiquement dans le navigateur. La page **Historique** permet de rouvrir ou de supprimer l’une des cinq dernières réunions.

Le parcours audio a été testé en français et en anglais. La salle a été vérifiée entre deux sessions Chrome, avec une invitation HTTPS et une analyse déclenchée après la réunion. L’import Meetily a été vérifié sur une base de test compatible. Les tests du moteur d’analyse se lancent avec `node verify.js`.

**Stack** · Python, Faster Whisper, pypdf, Node.js, JavaScript, WebRTC, IndexedDB, SQLite, Ollama et Qwen2.5.

## Démarrer

1. Sous Windows, récupérez le dépôt et installez Node.js 20+ et Python 3.11 ou 3.12. Le lanceur détecte aussi les outils livrés avec Codex.
2. Exécutez `Installer_audio.cmd` une fois pour récupérer Faster Whisper et le modèle multilingue Whisper Base (~145 Mo pour le modèle). L’audio reste local après installation.
3. Exécutez `Lancer_Studio.cmd` et utilisez `http://127.0.0.1:8468`. Choisissez un fichier MP3, WAV, M4A, WebM, OGG ou FLAC de 100 Mo maximum, ou chargez l’exemple audio synthétique en français.
4. Cliquez sur **Transcrire l’audio**. Corrigez le texte si nécessaire, puis cliquez sur **Analyser la réunion**. Le mode à règles est immédiat. Pour **IA locale · Qwen**, Ollama doit fonctionner et `ollama list` doit contenir `qwen2.5:7b`.
5. Consultez les décisions, les tâches et leurs preuves. Cliquez sur un repère horaire pour écouter uniquement le passage correspondant. La lecture s’arrête à la fin du segment. Relisez avant de valider et d’exporter.

## Traduction, documents et sauvegarde

Pour un résumé en français, choisissez **Anglais** ou **العربية**. Dans la transcription, cliquez sur **Anglais → Français** ou sélectionnez les mots anglais et utilisez **Traduire la sélection**. L’aperçu conserve les autres passages et les horodatages.

**Importer TXT ou PDF** accepte les PDF contenant du texte sélectionnable, jusqu’à 15 Mo et 100 pages. Un PDF scanné nécessite une reconnaissance OCR avant l’import.

**Historique** conserve les cinq dernières réunions dans le même navigateur, y compris un audio qui n’a pas encore été transcrit. La suppression d’une réunion retire aussi son audio, sa transcription et son compte rendu après confirmation.

## Historique des décisions

Pour les sujets reconnus (livraison, démonstration, tests, budget et publication), les dates différentes sont affichées dans l’ordre. Une validation après une proposition retient sa date. Plusieurs validations incompatibles restent à vérifier, sauf correction explicite. Ce regroupement heuristique fonctionne sur des formulations explicites en français. Il exige une relecture si plusieurs décisions distinctes abordent le même sujet.

## Raccordement à Meetily

Le bouton **Importer depuis Meetily** détecte `meeting_minutes.sqlite` dans les dossiers locaux de Meetily. Il affiche les réunions et ouvre les segments choisis, sans copier-coller, via une connexion SQLite en lecture seule. Si nécessaire, indiquez le chemin exact en définissant `MEETILY_DB` avant de lancer `node server.js`. Le raccordement utilise le schéma public de Meetily Community. Pour utiliser le lecteur et les liens audio, ouvrez l’enregistrement d’origine dans Réunions Studio et lancez sa transcription.

Le système utilise un seul moteur audio à la fois. Whisper Base est multilingue. L’exactitude varie selon la langue, la qualité audio et les échanges simultanés. Corrigez le texte avant d’analyser. Les règles d’analyse ciblent les réunions en français.

## Salle vidéo avec lien d’invitation

Installez [cloudflared](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) sur le poste hôte. Fermez `Lancer_Studio.cmd` si ouvert, puis exécutez `Lancer_Salle_En_Ligne.cmd`. Ouvrez la page **Salle en ligne**, créez une salle et partagez le lien HTTPS affiché avec les participants. Le lien est temporaire et peut changer lors d’une reconnexion. Gardez le lanceur ouvert pendant l’appel. La salle accepte jusqu’à six participants.

Les invités autorisent leur micro et acceptent que l’hôte puisse enregistrer l’audio. Chaque participant peut activer ou couper sa caméra. À la fin, **Terminer et analyser** ferme la salle, revient à l’atelier et lance la transcription puis l’analyse sur le poste hôte. L’hôte peut relire, valider et exporter le compte rendu.

Le tunnel sert uniquement la page d’invitation et la signalisation WebRTC. Les fichiers audio, la transcription, Meetily et le compte rendu restent locaux. L’audio et la vidéo de l’appel circulent via WebRTC. Certains réseaux bloquent les connexions directes. Si nécessaire, configurez un relais TURN avec identifiants à durée limitée via `REUNIONS_TURN_URL`, `REUNIONS_TURN_USER` et `REUNIONS_TURN_PASSWORD`. Une infrastructure HTTPS existante peut aussi servir la passerelle d’invitation sur le port 8467 via `REUNIONS_PUBLIC_URL`.

## Références

- [Meetily Community Edition](https://github.com/Zackriya-Solutions/meetily)
- [Stockage des réunions et transcriptions Meetily](https://github.com/Zackriya-Solutions/meetily/blob/main/frontend/src-tauri/src/database/repositories/meeting.rs)
- [Faster Whisper](https://github.com/SYSTRAN/faster-whisper)

## Fond de l’interface

`meeting-wallpaper.png` a été créé avec l’outil ImageGen intégré. Prompt utilisé :

> Photorealistic editorial landscape photograph, a modern glass-walled meeting room with four colleagues seated around a walnut table collaborating, shot from outside room through glass, some silhouetted side profiles and a person gesturing. Architectural photography, cinematic natural dusk, cool deep blue twilight through large windows and warm amber lamp reflections, warm walnut and muted taupe. Wide 16:9 wallpaper composition for a premium glass UI application: major recognizable human activity and glowing practical lamp concentrated in the LEFT third and far right edges, soft lower-contrast space in center-right, enough underlying contrast and details to be visible through translucent frosted cards. Authentic candid workplace photography, refined atmospheric depth, realistic lighting, dark navy shadows, no heavy pre-applied blur. The entire image is JUST the photograph, with no letters, no logos, no screens with readable text, and no UI graphics or glass overlays drawn into the photo.
