import json
import os
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / '.runtime'))


def emit(event, **data):
    print(json.dumps({'type': event, **data}, ensure_ascii=True), flush=True)


def load_model(allow_download=False):
    from faster_whisper import WhisperModel

    return WhisperModel('base', device='cpu', compute_type='int8', cpu_threads=4,
                        download_root=str(ROOT / '.models'), local_files_only=not allow_download)


def transcribe(audio, language):
    model = load_model()
    emit('ready')
    segments, info = model.transcribe(audio, language=None if language == 'auto' else language,
                                     beam_size=3, vad_filter=True, condition_on_previous_text=False)
    count = 0
    for segment in segments:
        if segment.text.strip():
            count += 1
            emit('segment', start=round(segment.start, 2), end=round(segment.end, 2), text=segment.text.strip())
    emit('done', count=count, language=info.language)


def meetily_path():
    custom = os.environ.get('MEETILY_DB')
    if custom:
        return Path(custom).expanduser() if Path(custom).expanduser().is_file() else None
    for key in ('APPDATA', 'LOCALAPPDATA'):
        folder = Path(os.environ[key]) if os.environ.get(key) else None
        if folder and folder.is_dir():
            for child in sorted(folder.iterdir()):
                if 'meetily' in child.name.lower() or 'zackriya' in child.name.lower():
                    db = child / 'meeting_minutes.sqlite'
                    if db.is_file():
                        return db
    return None


def meetily(meeting_id=None):
    file = meetily_path()
    if file is None:
        if meeting_id is None:
            emit('data', available=False, meetings=[])
            return
        raise ValueError('Base locale Meetily introuvable.')
    with sqlite3.connect(file.resolve().as_uri() + '?mode=ro', uri=True, timeout=2) as db:
        db.execute('PRAGMA query_only = ON')
        if meeting_id is None:
            meetings = db.execute('SELECT id, title, created_at FROM meetings ORDER BY created_at DESC LIMIT 100')
            emit('data', available=True, meetings=[{'id': row[0], 'title': row[1], 'date': row[2]} for row in meetings])
        else:
            rows = db.execute('SELECT transcript, audio_start_time, audio_end_time FROM transcripts '
                              'WHERE meeting_id = ? ORDER BY audio_start_time, timestamp', (meeting_id,))
            segments = []
            chars = 0
            for text, start, end in rows:
                if text and text.strip():
                    chars += len(text) + 16
                    if chars > 50000:
                        raise ValueError('Transcription Meetily trop longue. Traitez la réunion par extraits.')
                    segments.append({'text': ' '.join(text.split()), 'start': start, 'end': end})
            emit('data', segments=segments)


if __name__ == '__main__':
    try:
        command = sys.argv[1]
        if command == 'setup':
            load_model(allow_download=True)
            emit('done', count=0)
        elif command == 'transcribe':
            transcribe(sys.argv[2], sys.argv[3])
        elif command == 'meetily':
            meetily(sys.argv[2] if len(sys.argv) >= 3 else None)
        else:
            raise ValueError('Commande locale non reconnue.')
    except (ModuleNotFoundError, FileNotFoundError):
        emit('error', message='Moteur audio absent. Exécutez Installer_audio.cmd.')
        raise SystemExit(1)
    except sqlite3.Error:
        emit('error', message='Base Meetily inaccessible ou schéma incompatible.')
        raise SystemExit(1)
    except Exception as error:
        print(str(error), file=sys.stderr)
        message = str(error) if isinstance(error, ValueError) and sys.argv[1] == 'meetily' else 'Conversion audio impossible. Vérifiez le fichier et l’installation du modèle Whisper.'
        emit('error', message=message)
        raise SystemExit(1)
