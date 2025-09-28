"""Simple Reflex app with end-to-end logging.

Features:
- Enter an audio URL
- Download with progress logging
- Transcribe via AssemblyAI (if ASSEMBLYAI_API_KEY set)
- Summarize via an OpenAI-compatible endpoint (if OPENAI_* set)
- Live, line-by-line logs in the UI and console
"""
from __future__ import annotations

import os
import time
import uuid
from pathlib import Path
from typing import Iterable, Optional, List, Dict, Any, Callable, Generator
import json
import re
import html as htmlmod

import reflex as rx
import requests


DATA_ROOT = Path("data")
DATA_DIR = DATA_ROOT / "files"
JOBS_PATH = DATA_ROOT / "jobs.json"
DEFAULT_PROMPT_PATH = Path(os.getenv("PROMPT_PATH", "prompts/meeting_summary.md"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATA_ROOT.mkdir(parents=True, exist_ok=True)


def _log_print(prefix: str, msg: str) -> None:
    print(f"[{prefix}] {msg}")


def _load_prompt_text() -> str:
    try:
        if DEFAULT_PROMPT_PATH.exists():
            return DEFAULT_PROMPT_PATH.read_text(encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        _log_print("PROMPT", f"failed to read {DEFAULT_PROMPT_PATH}: {e}")
    return "Summarize this transcript clearly and concisely."


# Standalone pipeline helpers for testing and reuse
def resolve_plaud_audio_url(job_id: str, url: str, log: Callable[[str], None]) -> Generator[None, None, str]:
    """Resolve a Plaud share URL to a temporary S3 audio URL via their API.

    Strategy:
    1) Extract share token from the URL (/share/<token>)
    2) Call https://api.plaud.ai/file/share-file-temp/<token> and read 'temp_url'
    3) Fallback: https://api.plaud.ai/file/share-content/<token>
    4) Last resort: parse the share page for direct links
    """
    if "plaud.ai" not in url:
        return url
    log("Resolving Plaud link ..."); yield None

    # Extract token
    token = None
    try:
        m = re.search(r"/share/([0-9a-zA-Z]+)", url)
        if m:
            token = m.group(1)
    except Exception:
        token = None

    if token:
        # Primary API
        try:
            api = f"https://api.plaud.ai/file/share-file-temp/{token}"
            r = requests.get(api, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            data = r.json() if r.headers.get("content-type","" ).startswith("application/json") else None
            raw = data or r.text
            # Try typical keys
            if isinstance(raw, dict):
                for key in ("temp_url","url","fileUrl","audioUrl","downloadUrl"):
                    val = raw.get(key)
                    if isinstance(val, str) and val.startswith("http"):
                        log("Plaud API resolved (temp) → " + val); yield None
                        return val
            else:
                m2 = re.search(r"https?://[^\"'\s]+\.(?:mp3|m4a|wav)(?:\?[^\"'\s]*)?", r.text)
                if m2:
                    val = m2.group(0)
                    log("Plaud API resolved (regex) → " + val); yield None
                    return val
        except Exception as e:  # noqa: BLE001
            log(f"Plaud temp API failed: {e}"); yield None

        # Secondary API
        try:
            api = f"https://api.plaud.ai/file/share-content/{token}"
            r = requests.get(api, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            data = r.json()
            # Navigate potential structures
            cand = None
            if isinstance(data, dict):
                d = data.get("data", data)
                for key in ("fileUrl","audioUrl","url"):
                    if isinstance(d, dict) and d.get(key):
                        cand = d[key]
                        break
            if cand:
                log("Plaud content API resolved → " + cand); yield None
                return cand
        except Exception as e:  # noqa: BLE001
            log(f"Plaud content API failed: {e}"); yield None

    # Fallback: parse share page
    try:
        r = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        html = r.text
        # Direct links in HTML
        candidates = re.findall(r"https?://[^'\"\s]+\.(?:mp3|m4a|wav)\b", html, re.I)
        if candidates:
            resolved = candidates[0]
            log(f"Plaud resolved (html) → {resolved}"); yield None
            return resolved
        # __NEXT_DATA__ JSON
        m = re.search(r"<script[^>]*id=\"__NEXT_DATA__\"[^>]*>(.*?)</script>", html, re.I | re.S)
        if m:
            raw = htmlmod.unescape(m.group(1))
            try:
                data = json.loads(raw)
                for s in _walk_strings(data):
                    s_dec = s.replace("\\u002F", "/")
                    if re.match(r"https?://.*\.(mp3|m4a|wav)(\?.*)?$", s_dec, re.I):
                        log(f"Plaud resolved (next) → {s_dec}"); yield None
                        return s_dec
            except Exception:
                pass
        # Generic JSON URL keys in HTML
        m2 = re.findall(r'"(audioUrl|audio_url|url|source|src)"\s*:\s*"(https?://[^"]+)"', html, re.I)
        for _, candidate in m2:
            cand = candidate.replace("\\u002F", "/")
            if any(cand.lower().endswith(ext) for ext in (".mp3", ".m4a", ".wav")):
                log(f"Plaud resolved (json) → {cand}"); yield None
                return cand
    except Exception as e:  # noqa: BLE001
        log(f"Plaud resolution error: {e}; using original URL"); yield None
        return url

    log("Plaud resolution failed; using original URL"); yield None
    return url


def download_audio_file(job_id: str, url: str, log: Callable[[str], None]) -> Generator[None, None, str]:
    log("Downloading audio ..."); yield None
    headers = {"User-Agent": "FocusFlow/mini (reflex)"}
    with requests.get(url, stream=True, timeout=60, headers=headers) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        ext = _guess_ext(url, r.headers.get("content-type", ""))
        path = DATA_DIR / f"{job_id}{ext}"
        ctype = r.headers.get("content-type", "").lower()
        if not ("audio" in ctype or "octet-stream" in ctype or ext in (".mp3", ".m4a", ".wav")):
            raise RuntimeError(f"URL did not resolve to audio content-type (got '{ctype}')")
        bytes_done = 0
        last_emit = 0
        chunk_iter: Iterable[bytes] = r.iter_content(chunk_size=1024 * 256)
        with open(path, "wb") as f:
            for chunk in chunk_iter:
                if not chunk:
                    continue
                f.write(chunk)
                bytes_done += len(chunk)
                now = time.time()
                if now - last_emit > 0.1:
                    last_emit = now
                    pct = (bytes_done / total * 100) if total else 0.0
                    log(f"download: {bytes_done}/{total or '?'} bytes ({pct:.1f}%)"); yield None
    return str(path)


def transcribe_with_assemblyai(job_id: str, file_path: str, log: Callable[[str], None]) -> Generator[None, None, Optional[str]]:
    if not os.getenv("ASSEMBLYAI_API_KEY"):
        log("ASSEMBLYAI_API_KEY not set → skipping transcription"); yield None
        return None
    api_key = os.getenv("ASSEMBLYAI_API_KEY", "")
    base = "https://api.assemblyai.com/v2"
    headers = {"authorization": api_key}
    # Upload file
    log("Uploading to AssemblyAI ..."); yield None
    def _gen():
        with open(file_path, "rb") as f:
            while True:
                data = f.read(5 * 1024 * 1024)
                if not data:
                    break
                yield data
    r = requests.post(f"{base}/upload", headers=headers, data=_gen(), timeout=600)
    r.raise_for_status()
    upload_url = r.json()["upload_url"]
    log("Create transcript job with speaker diarization ..."); yield None
    r = requests.post(
        f"{base}/transcript",
        headers={**headers, "content-type": "application/json"},
        json={
            "audio_url": upload_url,
            "speaker_labels": True,  # Enable speaker diarization
            "speakers_expected": 2,  # Expect 2 speakers (can adjust or remove)
            "auto_highlights": True,  # Get key points
            "sentiment_analysis": True,  # Analyze sentiment
            "entity_detection": True,  # Detect entities
            "format_text": True,  # Format with punctuation
        },
        timeout=30,
    )
    r.raise_for_status()
    tid = r.json()["id"]
    log(f"Transcript id={tid}; polling ..."); yield None
    status = "queued"
    while status not in {"completed", "error"}:
        time.sleep(2)
        r = requests.get(f"{base}/transcript/{tid}", headers=headers, timeout=30)
        r.raise_for_status()
        body = r.json()
        status = body.get("status", "?")
        log(f"transcribe: status={status}"); yield None
        if status == "completed":
            # Format transcript with speaker labels if available
            utterances = body.get("utterances", [])
            if utterances:
                # Format with speaker labels
                formatted_transcript = []
                current_speaker = None
                for utt in utterances:
                    speaker = f"Speaker {utt.get('speaker', 'Unknown')}"
                    text = utt.get("text", "").strip()
                    if speaker != current_speaker:
                        if formatted_transcript:
                            formatted_transcript.append("")  # Add blank line between speakers
                        formatted_transcript.append(f"[{speaker}]:")
                        current_speaker = speaker
                    formatted_transcript.append(text)

                # Also include any auto_highlights if available
                highlights = body.get("auto_highlights_result", {}).get("results", [])
                if highlights:
                    formatted_transcript.append("\n\n--- Key Points ---")
                    for h in highlights[:5]:  # Top 5 highlights
                        formatted_transcript.append(f"• {h.get('text', '')}")

                return "\n".join(formatted_transcript)
            else:
                # Fallback to simple text if no utterances
                return body.get("text", "")
        if status == "error":
            err = body.get("error", "unknown error")
            raise RuntimeError(f"transcription failed: {err}")
    return None


def generate_title_from_summary(summary: str) -> str:
    """Generate a concise, meaningful title from the summary using AI."""
    if not summary:
        return ""

    # If no OpenAI API configured, fallback to extraction
    if not (os.getenv("OPENAI_API_KEY") and os.getenv("OPENAI_BASE_URL")):
        return extract_title_from_summary(summary)

    try:
        base = os.getenv("OPENAI_BASE_URL", "").rstrip("/")
        api_key = os.getenv("OPENAI_API_KEY", "")
        model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

        # Load title generation prompt
        title_prompt_path = Path("prompts/title_generator.md")
        if title_prompt_path.exists():
            prompt_template = title_prompt_path.read_text(encoding="utf-8")
            # Replace the placeholder with actual content
            prompt = prompt_template.replace("[The meeting transcript/summary will be inserted here]", summary[:500])
        else:
            # Fallback prompt if file doesn't exist
            prompt = f"Generate a concise title (max 50 chars) for: {summary[:500]}"

        # Use chat completions for title generation
        url = f"{base}/v1/chat/completions"

        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": "You are a title generator. Return only the title text."},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.3,
            "max_tokens": 20
        }

        response = requests.post(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            json=payload,
            timeout=5
        )

        if response.status_code == 200:
            result = response.json()
            title = result.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
            # Clean up the title
            title = title.strip('"\'')  # Remove quotes if any
            if title and len(title) <= 60:
                return title
    except Exception as e:
        print(f"Error generating title: {e}")

    # Fallback to extraction
    return extract_title_from_summary(summary)


def extract_title_from_summary(summary: str) -> str:
    """Extract a concise title from the summary text as fallback."""
    if not summary:
        return ""

    import re

    # Clean up markdown headers first
    summary = re.sub(r'^#+\s*', '', summary, flags=re.MULTILINE)

    # Look for key phrases that might be the topic
    patterns = [
        r"(?:Topic|Subject|Meeting about|Discussion about|Overview)[:\s]*([^\n.]+)",
        r"^([A-Z][^.!?\n]{10,50})",  # First sentence-like text
    ]

    for pattern in patterns:
        match = re.search(pattern, summary, re.IGNORECASE | re.MULTILINE)
        if match:
            title = match.group(1).strip()
            # Clean and limit
            title = re.sub(r'[*_#]', '', title)
            if len(title) > 50:
                title = title[:47] + "..."
            return title

    # Fallback: First meaningful line
    lines = summary.split('\n')
    for line in lines[:5]:  # Check first 5 lines
        line = line.strip()
        if line and len(line) > 10:
            title = re.sub(r'[*_#]', '', line)
            if len(title) > 50:
                title = title[:47] + "..."
            return title

    return "Meeting Summary"


def summarize_with_gpt(job_id: str, text: str, log: Callable[[str], None], meeting_date: str = "") -> Generator[None, None, Optional[str]]:
    """Summarize using the OpenAI Responses API, with graceful fallback parsing.

    Uses POST {OPENAI_BASE_URL}/v1/responses with {model, input}.
    If the server still implements Chat Completions, we try to parse that too.
    Any non-2xx returns None instead of raising to keep the pipeline flowing.
    """
    if not (os.getenv("OPENAI_API_KEY") and os.getenv("OPENAI_BASE_URL")):
        log("OPENAI_* not set → skipping summarization"); yield None
        return None
    base = os.getenv("OPENAI_BASE_URL", "").rstrip("/")
    api_key = os.getenv("OPENAI_API_KEY", "")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    url = f"{base}/v1/responses"
    prompt_text = _load_prompt_text()
    payload = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": prompt_text + (f"\n\nMeeting Date: {meeting_date}" if meeting_date else "") + "\n\nTranscript:\n" + text,
                    }
                ],
            }
        ],
        "temperature": 0.2,
        "stream": True,
    }
    log("Calling GPT endpoint (Responses API, stream) ..."); yield None
    try:
        r = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=300,
            stream=True,
        )
        if r.status_code >= 400:
            log(f"GPT endpoint HTTP {r.status_code}; skipping"); yield None
            return None
        # Stream parse SSE lines (force UTF-8 to avoid mojibake), collecting deltas
        content = ""
        try:
            r.encoding = "utf-8"
        except Exception:
            pass
        for raw_line in r.iter_lines(chunk_size=8192):
            if not raw_line:
                continue
            try:
                line = raw_line.decode("utf-8").strip()
            except Exception:
                line = raw_line.decode("utf-8", errors="replace").strip()
            if line.startswith("data:"):
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    obj = json.loads(payload)
                except Exception:
                    continue
                # 1) Direct output_text on root (rare) or nested under 'response'
                if isinstance(obj, dict):
                    if obj.get("output_text"):
                        content = str(obj["output_text"]).strip()
                        continue
                    resp = obj.get("response")
                    if isinstance(resp, dict):
                        if resp.get("output_text"):
                            content = str(resp["output_text"]).strip()
                            continue
                        out = resp.get("output")
                        if isinstance(out, list):
                            for item in out:
                                if isinstance(item, dict) and item.get("type") == "output_text":
                                    content += str(item.get("text", ""))
                            continue
                # Delta-style events
                t = obj.get("type") if isinstance(obj, dict) else None
                if t == "output_text.delta":
                    content += str(obj.get("delta", ""))
                    continue
                if t == "response.output_text.delta":
                    content += str(obj.get("delta", ""))
                    continue
                if t in ("message.delta","response.message.delta"):
                    delta = obj.get("delta", {}) if isinstance(obj, dict) else {}
                    if isinstance(delta, dict):
                        cont = delta.get("content")
                        if isinstance(cont, list):
                            for c in cont:
                                if isinstance(c, dict):
                                    if c.get("type") in ("output_text","text"):
                                        content += str(c.get("text", ""))
                            continue
                # Other possible shapes
                if isinstance(obj, dict):
                    out = obj.get("output")
                    if isinstance(out, list):
                        for item in out:
                            if isinstance(item, dict) and item.get("type") == "output_text":
                                content += str(item.get("text", ""))
        content = content.strip()
        if not content:
            log("GPT returned empty content"); yield None
            return None
        log("GPT call complete"); yield None
        return content
    except Exception as e:  # noqa: BLE001
        log(f"GPT error: {e}; skipping"); yield None
        return None


def cleanup_job_artifacts(job_id: str, file_path: Optional[str]) -> None:
    try:
        if file_path:
            try:
                p = Path(file_path)
                if p.exists():
                    p.unlink(missing_ok=True)
            except Exception as e:  # noqa: BLE001
                _log_print(job_id, f"warn: failed to remove file_path: {e}")
        for p in DATA_DIR.glob(f"{job_id}*"):
            try:
                p.unlink(missing_ok=True)
            except Exception as e:  # noqa: BLE001
                _log_print(job_id, f"warn: failed to remove artifact {p.name}: {e}")
    except Exception as e:  # noqa: BLE001
        _log_print(job_id, f"warn: cleanup error: {e}")


class AppState(rx.State):
    # Inputs
    audio_url: str = ""

    # Jobs store
    jobs: List[Dict[str, Any]] = []
    current_job_id: str = ""
    transcript_open: bool = False

    # Env/config cached in state for transparency (read-only in UI)
    assemblyai_enabled: bool = bool(os.getenv("ASSEMBLYAI_API_KEY"))
    openai_enabled: bool = bool(os.getenv("OPENAI_API_KEY") and os.getenv("OPENAI_BASE_URL"))

    # Helpers
    def _append_log(self, job_id: str, line: str) -> None:
        j = self._get_job(job_id)
        if not j:
            return
        j.setdefault("logs", []).append(line)
        _log_print(job_id, line)
        self._save()

    def clear(self) -> None:
        if self.current_job_id:
            j = self._get_job(self.current_job_id)
            if j:
                j["logs"] = []
                j["transcript"] = ""
                j["summary"] = ""
                j["error"] = ""
                j["status"] = "queued"
        else:
            self.jobs = []
        self._save()

    def _get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        for j in self.jobs:
            if j.get("id") == job_id:
                return j
        return None

    def _save(self) -> None:
        try:
            with open(JOBS_PATH, "w") as f:
                json.dump(self.jobs, f, indent=2)
        except Exception as e:  # noqa: BLE001
            _log_print("SAVE", f"failed to save jobs: {e}")

    def hydrate(self):
        try:
            if JOBS_PATH.exists():
                with open(JOBS_PATH) as f:
                    self.jobs = json.load(f)
        except Exception as e:  # noqa: BLE001
            _log_print("LOAD", f"failed to load jobs: {e}")
            self.jobs = []
        # Backfill created_label and path for existing jobs
        changed = False
        for j in self.jobs:
            if not j.get("created_label"):
                try:
                    ts = int(j.get("created_at", time.time()))
                    j["created_label"] = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts))
                    changed = True
                except Exception:
                    j["created_label"] = ""
            if j.get("id") and not j.get("path"):
                j["path"] = f"/job/{j['id']}"
                changed = True
        if changed:
            self._save()
        if self.jobs and not self.current_job_id:
            self.current_job_id = self.jobs[0]["id"]

    def init_job_view(self, job_id: str):
        """Ensure jobs are hydrated and set the current selection for detail view.
        Also normalizes the route param (strip any trailing slash)."""
        jid = (job_id or "").strip().strip("/")
        if not self.jobs:
            try:
                if JOBS_PATH.exists():
                    with open(JOBS_PATH) as f:
                        self.jobs = json.load(f)
            except Exception as e:  # noqa: BLE001
                _log_print("LOAD", f"failed to load jobs: {e}")
                self.jobs = []
            # Backfill fields
            changed = False
            for j in self.jobs:
                if not j.get("created_label"):
                    try:
                        ts = int(j.get("created_at", time.time()))
                        j["created_label"] = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts))
                        changed = True
                    except Exception:
                        j["created_label"] = ""
                if j.get("id") and not j.get("path"):
                    j["path"] = f"/job/{j['id']}"
                    changed = True
            if changed:
                self._save()
        self.current_job_id = jid

    def load_job(self, job_id: str):
        """Load and select a specific job by ID. Normalizes the ID and ensures jobs are hydrated."""
        # Normalize job_id - strip whitespace and trailing slash
        normalized_id = (job_id or "").strip().strip("/")

        # Hydrate jobs from disk if needed
        if not self.jobs:
            try:
                if JOBS_PATH.exists():
                    with open(JOBS_PATH) as f:
                        self.jobs = json.load(f)
            except Exception as e:  # noqa: BLE001
                _log_print("LOAD", f"failed to load jobs: {e}")
                self.jobs = []

            # Backfill required display fields
            changed = False
            for j in self.jobs:
                if not j.get("created_label"):
                    try:
                        ts = int(j.get("created_at", time.time()))
                        j["created_label"] = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts))
                        changed = True
                    except Exception:
                        j["created_label"] = ""
                if j.get("id") and not j.get("path"):
                    j["path"] = f"/job/{j['id']}"
                    changed = True
            if changed:
                self._save()

        # Set the current job ID
        if normalized_id:
            self.current_job_id = normalized_id

    # Derived props for the selected job with explicit typing
    @rx.var
    def current_job(self) -> Optional[Dict[str, Any]]:
        for j in self.jobs:
            if j.get("id") == self.current_job_id:
                return j
        return None

    @rx.var
    def current_logs(self) -> List[str]:
        j = self.current_job
        return list(j.get("logs", [])) if j else []

    @rx.var
    def current_transcript(self) -> str:
        j = self.current_job
        return str(j.get("transcript", "")) if j else ""

    @rx.var
    def current_summary(self) -> str:
        j = self.current_job
        return str(j.get("summary", "")) if j else ""

    @rx.var
    def current_status(self) -> str:
        j = self.current_job
        return str(j.get("status", "")) if j else ""

    @rx.var
    def current_meeting_date(self) -> str:
        j = self.current_job
        return str(j.get("meeting_date", "")) if j else ""

    def toggle_transcript(self):
        """Toggle transcript visibility."""
        self.transcript_open = not self.transcript_open

    def _extract_date_from_url(self, url: str) -> str:
        """Extract date from URL or filename. For Plaud URLs, fetch the page to get the date."""
        import re
        from datetime import datetime
        import requests

        # Check if this is a Plaud URL
        if 'plaud.ai' in url:
            try:
                # Fetch the page to get the date from metadata
                response = requests.get(url, timeout=10)
                if response.status_code == 200:
                    # Look for date in the HTML title or meta tags
                    # Plaud shows date in format like "2025-09-25 20:05:39"
                    date_pattern = r'(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}'
                    match = re.search(date_pattern, response.text)
                    if match:
                        return match.group(1)  # Return just the date part
            except Exception as e:
                print(f"Could not fetch date from Plaud URL: {e}")

        # Common date patterns in URLs/filenames
        patterns = [
            r'(\d{4}[-_]\d{2}[-_]\d{2})',  # 2025-09-28 or 2025_09_28
            r'(\d{8})',  # 20250928
            r'(\d{2}[-_]\d{2}[-_]\d{4})',  # 09-28-2025 or 09_28_2025
            r'(\d{4}[-/]\d{1,2}[-/]\d{1,2})',  # 2025-9-28 or 2025/09/28
        ]

        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                date_str = match.group(1)
                # Normalize the date string
                date_str = date_str.replace('_', '-').replace('/', '-')

                # Try to parse and format it
                try:
                    # Try different formats
                    for fmt in ['%Y-%m-%d', '%Y%m%d', '%m-%d-%Y', '%d-%m-%Y']:
                        try:
                            date_obj = datetime.strptime(date_str, fmt)
                            return date_obj.strftime('%Y-%m-%d')
                        except ValueError:
                            continue
                except Exception:
                    pass

        return ""  # Return empty if no date found

    # Public events
    def add_job(self):
        url = self.audio_url.strip()
        if not url:
            return
        job_id = uuid.uuid4().hex[:8]

        # Extract meeting date from URL if possible
        meeting_date = self._extract_date_from_url(url)

        job = {
            "id": job_id,
            "url": url,
            "status": "queued",
            "created_at": int(time.time()),
            "created_label": time.strftime("%Y-%m-%d %H:%M:%S"),
            "meeting_date": meeting_date,  # Store the extracted meeting date
            "title": "",  # AI-generated title from summary
            "path": f"/job/{job_id}",
            "error": "",
            "file_path": "",
            "transcript": "",
            "summary": "",
            "logs": [],
        }
        self.jobs.insert(0, job)
        self.current_job_id = job_id
        self._save()
        yield from self.run_job(job_id)

    def select_job(self, job_id: str):
        self.current_job_id = job_id

    def run_job(self, job_id: str):
        j = self._get_job(job_id)
        if not j:
            return
        if j.get("status") in {"running", "downloading", "transcribing", "summarizing"}:
            return
        j["status"] = "running"
        self._save()
        yield self._append_log(job_id, "Starting pipeline")
        try:
            # Resolve Plaud link if needed (API-based resolver)
            resolved = yield from resolve_plaud_audio_url(job_id, j["url"], lambda m: self._append_log(job_id, m))
            j["resolved_url"] = resolved
            self._save()

            # Download
            j["status"] = "downloading"
            self._save()
            file_path = yield from download_audio_file(job_id, resolved, lambda m: self._append_log(job_id, m))
            j["file_path"] = file_path
            self._save()
            yield self._append_log(job_id, f"Downloaded to {file_path}")

            # Transcribe
            j["status"] = "transcribing"
            self._save()
            text = yield from transcribe_with_assemblyai(job_id, file_path, lambda m: self._append_log(job_id, m))
            j["transcript"] = text or ""
            self._save()
            if text:
                yield self._append_log(job_id, f"Transcription complete: {len(text)} chars")
            else:
                yield self._append_log(job_id, "Transcription skipped or failed; proceeding")

            # Summarize
            j["status"] = "summarizing"
            self._save()
            summary = (
                (yield from summarize_with_gpt(job_id, j["transcript"], lambda m: self._append_log(job_id, m), j.get("meeting_date", "")))
                if j["transcript"] else None
            )
            j["summary"] = summary or ""
            # Generate title from summary using AI
            if summary:
                j["title"] = generate_title_from_summary(summary)
            self._save()
            if summary:
                yield self._append_log(job_id, f"Summary complete: {len(summary)} chars")
            else:
                yield self._append_log(job_id, "Summary skipped or failed")

            j["status"] = "completed"
            self._save()
            yield self._append_log(job_id, "Pipeline done.")
        except Exception as e:  # noqa: BLE001
            j["status"] = "error"
            j["error"] = f"{type(e).__name__}: {e}"
            self._save()
            yield self._append_log(job_id, f"ERROR: {j['error']}")

    def retry_current(self):
        jid = self.current_job_id
        if not jid:
            return
        j = self._get_job(jid)
        if not j:
            return
        j.update({
            "status": "queued",
            "error": "",
            "logs": [],
            "transcript": "",
            "summary": "",
        })
        self._save()
        yield from self.run_job(jid)

    def delete_current(self):
        jid = self.current_job_id
        if not jid:
            return
        # Remove artifacts on disk (audio files for this job)
        try:
            # Delete by recorded file_path first
            j = self._get_job(jid)
            if j and j.get("file_path"):
                try:
                    p = Path(j["file_path"])
                    if p.exists():
                        p.unlink(missing_ok=True)
                except Exception as e:  # noqa: BLE001
                    _log_print(jid, f"warn: failed to remove file_path: {e}")
            # Also delete any leftover artifacts matching the job id prefix
            for p in DATA_DIR.glob(f"{jid}*"):
                try:
                    p.unlink(missing_ok=True)
                except Exception as e:  # noqa: BLE001
                    _log_print(jid, f"warn: failed to remove artifact {p.name}: {e}")
        except Exception as e:  # noqa: BLE001
            _log_print(jid, f"warn: cleanup error: {e}")

        # Remove from state and persist
        self.jobs = [j for j in self.jobs if j.get("id") != jid]
        self.current_job_id = self.jobs[0]["id"] if self.jobs else ""
        self._save()
        # Redirect to home page after deletion
        yield rx.redirect("/")

    def delete_by_id(self, job_id: str):
        self.current_job_id = job_id
        result = self.delete_current()
        if result is not None:
            yield from result

    def goto_job(self, job_id: str):
        """Select a job then navigate to its detail route."""
        self.current_job_id = job_id
        yield rx.redirect(f"/job/{job_id}")

    def regenerate_summary_for(self, job_id: str):
        j = self._get_job(job_id)
        if not j:
            return
        transcript = j.get("transcript", "")
        if not transcript:
            yield self._append_log(job_id, "No transcript available → cannot summarize")
            return
        j["summary"] = ""
        j["status"] = "summarizing"
        self._save()
        yield self._append_log(job_id, "Regenerating summary ...")
        try:
            summary = yield from summarize_with_gpt(job_id, transcript, lambda m: self._append_log(job_id, m), j.get("meeting_date", ""))
            j["summary"] = summary or ""
            # Generate title from summary using AI
            if summary:
                j["title"] = generate_title_from_summary(summary)
            j["status"] = "completed"
            self._save()
            if summary:
                yield self._append_log(job_id, f"Summary regenerated: {len(summary)} chars")
            else:
                yield self._append_log(job_id, "Summary regeneration returned empty")
        except Exception as e:  # noqa: BLE001
            j["status"] = "error"
            self._save()
            yield self._append_log(job_id, f"ERROR: summarize: {e}")

    def retry_job(self, job_id: str):
        j = self._get_job(job_id)
        if not j:
            return
        j.update({
            "status": "queued",
            "error": "",
            "logs": [],
            "summary": j.get("summary", ""),
        })
        self._save()
        yield from self.run_job(job_id)

    def regenerate_summary(self):
        """Re-run summarization for the selected job using its transcript.
        Overwrites the existing summary. Streams logs to the UI.
        """
        jid = self.current_job_id
        if not jid:
            return
        j = self._get_job(jid)
        if not j:
            return
        transcript = j.get("transcript", "")
        if not transcript:
            yield self._append_log(jid, "No transcript available → cannot summarize")
            return
        j["summary"] = ""
        j["status"] = "summarizing"
        self._save()
        yield self._append_log(jid, "Regenerating summary ...")
        try:
            summary = yield from summarize_with_gpt(jid, transcript, lambda m: self._append_log(jid, m), j.get("meeting_date", ""))
            j["summary"] = summary or ""
            # Generate title from summary using AI
            if summary:
                j["title"] = generate_title_from_summary(summary)
            j["status"] = "completed"
            self._save()
            if summary:
                yield self._append_log(jid, f"Summary regenerated: {len(summary)} chars")
            else:
                yield self._append_log(jid, "Summary regeneration returned empty")
        except Exception as e:  # noqa: BLE001
            j["status"] = "error"
            self._save()
            yield self._append_log(jid, f"ERROR: summarize: {e}")

    # Internal steps
    def _download_audio(self, job_id: str, url: str):
        yield self._append_log(job_id, "Downloading audio ...")
        headers = {"User-Agent": "FocusFlow/mini (reflex)"}
        with requests.get(url, stream=True, timeout=60, headers=headers) as r:
            r.raise_for_status()
            total = int(r.headers.get("content-length", 0))
            ext = _guess_ext(url, r.headers.get("content-type", ""))
            path = DATA_DIR / f"{job_id}{ext}"
            ctype = r.headers.get("content-type", "").lower()
            if not ("audio" in ctype or "octet-stream" in ctype or ext in (".mp3", ".m4a", ".wav")):
                raise RuntimeError(f"URL did not resolve to audio content-type (got '{ctype}')")
            bytes_done = 0
            last_emit = 0
            chunk_iter: Iterable[bytes] = r.iter_content(chunk_size=1024 * 256)
            with open(path, "wb") as f:
                for chunk in chunk_iter:
                    if not chunk:
                        continue
                    f.write(chunk)
                    bytes_done += len(chunk)
                    # Throttle progress logs to ~10/second
                    now = time.time()
                    if now - last_emit > 0.1:
                        last_emit = now
                        pct = (bytes_done / total * 100) if total else 0.0
                        yield self._append_log(job_id, f"download: {bytes_done}/{total or '?'} bytes ({pct:.1f}%)")
        return str(path)

    def _transcribe(self, job_id: str, file_path: str):
        if not self.assemblyai_enabled:
            yield self._append_log(job_id, "ASSEMBLYAI_API_KEY not set → skipping transcription")
            return None

        api_key = os.getenv("ASSEMBLYAI_API_KEY", "")
        base = "https://api.assemblyai.com/v2"
        headers = {"authorization": api_key}

        # Upload file
        yield self._append_log(job_id, "Uploading to AssemblyAI ...")
        def _gen():
            with open(file_path, "rb") as f:
                while True:
                    data = f.read(5 * 1024 * 1024)
                    if not data:
                        break
                    yield data

        r = requests.post(f"{base}/upload", headers=headers, data=_gen(), timeout=600)
        r.raise_for_status()
        upload_url = r.json()["upload_url"]
        yield self._append_log(job_id, "Create transcript job ...")
        r = requests.post(
            f"{base}/transcript",
            headers={**headers, "content-type": "application/json"},
            json={"audio_url": upload_url},
            timeout=30,
        )
        r.raise_for_status()
        tid = r.json()["id"]
        yield self._append_log(job_id, f"Transcript id={tid}; polling ...")

        # Poll
        status = "queued"
        while status not in {"completed", "error"}:
            time.sleep(2)
            r = requests.get(f"{base}/transcript/{tid}", headers=headers, timeout=30)
            r.raise_for_status()
            body = r.json()
            status = body.get("status", "?")
            yield self._append_log(job_id, f"transcribe: status={status}")
            if status == "completed":
                text = body.get("text", "")
                return text
            if status == "error":
                err = body.get("error", "unknown error")
                raise RuntimeError(f"transcription failed: {err}")
        return None

    def _summarize(self, job_id: str, text: str):
        if not self.openai_enabled:
            yield self._append_log(job_id, "OPENAI_* not set → skipping summarization")
            return None

        base = os.getenv("OPENAI_BASE_URL", "").rstrip("/")
        api_key = os.getenv("OPENAI_API_KEY", "")
        model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        url = f"{base}/v1/chat/completions"
        yield self._append_log(job_id, "Calling GPT endpoint ...")
        r = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": "Summarize transcripts clearly and concisely."},
                    {"role": "user", "content": f"Summarize this transcript:\n\n{text}"},
                ],
                "temperature": 0.2,
            },
            timeout=120,
        )
        r.raise_for_status()
        data = r.json()
        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        content = message.get("content", "").strip()
        yield self._append_log(job_id, "GPT call complete")
        return content or None

    def _resolve_audio_url(self, job_id: str, url: str):
        # Try to resolve Plaud share links to a direct audio URL.
        if "plaud.ai" not in url:
            return url
        yield self._append_log(job_id, "Resolving Plaud link ...")
        try:
            r = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            html = r.text
            # Pass 1: direct links in HTML
            candidates = re.findall(r"https?://[^'\"\s]+\.(?:mp3|m4a|wav)\b", html, re.I)
            if candidates:
                resolved = candidates[0]
                yield self._append_log(job_id, f"Plaud resolved → {resolved}")
                return resolved
            # Pass 2: __NEXT_DATA__ JSON
            m = re.search(r"<script[^>]*id=\"__NEXT_DATA__\"[^>]*>(.*?)</script>", html, re.I | re.S)
            if m:
                raw = htmlmod.unescape(m.group(1))
                try:
                    data = json.loads(raw)
                    for s in _walk_strings(data):
                        s_dec = s.replace("\\u002F", "/")
                        if re.match(r"https?://.*\.(mp3|m4a|wav)(\?.*)?$", s_dec, re.I):
                            yield self._append_log(job_id, f"Plaud resolved (next) → {s_dec}")
                            return s_dec
                except Exception:
                    pass
            # Pass 3: generic JSON URL keys
            m2 = re.findall(r'"(audioUrl|audio_url|url|source|src)"\s*:\s*"(https?://[^"]+)"', html, re.I)
            for _, candidate in m2:
                cand = candidate.replace("\\u002F", "/")
                if any(cand.lower().endswith(ext) for ext in (".mp3", ".m4a", ".wav")):
                    yield self._append_log(job_id, f"Plaud resolved (json) → {cand}")
                    return cand
            # Give up
            yield self._append_log(job_id, "Plaud resolution failed; using original URL")
            return url
        except Exception as e:  # noqa: BLE001
            yield self._append_log(job_id, f"Plaud resolution error: {e}; using original URL")
            return url


def _guess_ext(url: str, ctype: str) -> str:
    url_low = url.lower()
    if ".mp3" in url_low:
        return ".mp3"
    if ".m4a" in url_low:
        return ".m4a"
    if ".wav" in url_low:
        return ".wav"
    if "mpeg" in ctype:
        return ".mp3"
    if "wav" in ctype:
        return ".wav"
    if "mp4" in ctype or "mp4a" in ctype or "aac" in ctype:
        return ".m4a"
    return ".bin"


def _walk_strings(obj: Any) -> Iterable[str]:
    try:
        if isinstance(obj, str):
            yield obj
        elif isinstance(obj, dict):
            for v in obj.values():
                yield from _walk_strings(v)
        elif isinstance(obj, (list, tuple)):
            for v in obj:
                yield from _walk_strings(v)
    except Exception:
        return


def _job_row(job: dict) -> rx.Component:
    return rx.hstack(
        rx.vstack(
            rx.text(job["url"], weight="medium", size="3", max_width="600px", overflow="hidden", text_overflow="ellipsis", white_space="nowrap"),
            rx.hstack(
                rx.code(job["id"]),
                rx.badge(job["status"], color_scheme=rx.cond(job["status"] == "completed", "green", rx.cond(job["status"] == "error", "red", "gray"))),
                spacing="2",
            ),
            spacing="1",
            align="start",
        ),
        justify="between",
        width="100%",
        padding_y="8px",
    )


def _status_color(status: str) -> str:
    mapping = {
        "queued": "gray",
        "running": "blue",
        "downloading": "blue",
        "transcribing": "blue",
        "summarizing": "blue",
        "completed": "green",
        "error": "red",
    }
    return mapping.get(status, "gray")


def _relative_time(ts: int) -> str:
    try:
        delta = int(time.time()) - int(ts)
    except Exception:
        return "just now"
    if delta < 60:
        return f"{delta}s ago"
    if delta < 3600:
        return f"{delta//60}m ago"
    if delta < 86400:
        return f"{delta//3600}h ago"
    return f"{delta//86400}d ago"


def _job_card(j: dict) -> rx.Component:
    return rx.box(
        rx.flex(
            rx.vstack(
                # Title or URL with proper contrast
                rx.text(
                    rx.cond(
                        j.get("title", ""),
                        j["title"],
                        j["url"]
                    ),
                    size="2",
                    weight="bold",
                    overflow="hidden",
                    text_overflow="ellipsis",
                    white_space="nowrap",
                    width="100%",
                    style={"color": "#ffffff"},  # Force white text
                ),
                rx.flex(
                    rx.cond(
                        j.get("meeting_date", ""),
                        rx.text("📅 ", j.get("meeting_date", ""), style={"color": "#60a5fa"}, size="2"),  # Light blue
                        rx.text(j["created_label"], style={"color": "#9ca3af"}, size="1")  # Light gray
                    ),
                    rx.badge(j["status"], color_scheme=_status_color(j["status"]), variant="soft"),
                    gap="2",
                    wrap="wrap",
                ),
                spacing="1",
                align="start",
                width="100%",
            ),
            rx.spacer(),  # Spacer between content and buttons
            rx.flex(
                rx.button("View", size="3", variant="solid", on_click=lambda: AppState.goto_job(j["id"]), cursor="pointer"),
                rx.button("Delete", size="3", variant="soft", color_scheme="red", on_click=lambda: AppState.delete_by_id(j["id"]), cursor="pointer"),
                gap="2",
                width="100%",
                margin_top="2",
            ),
            direction="column",  # Always stack for mobile-first
            align="center",
            width="100%",
        ),
        width="100%",
        border="1px solid",
        border_color="gray.600",
        bg="gray.900",  # Dark background for white text contrast
        padding="12px",
        border_radius="12px",
        box_shadow="0 1px 2px rgba(0,0,0,0.04)",
        _hover={"boxShadow": "0 2px 8px rgba(0,0,0,0.06)", "bg": "gray.800"},
        cursor="pointer",
        on_click=lambda: rx.redirect(j["path"]),
    )


def index() -> rx.Component:
    return rx.center(
        rx.vstack(
            rx.heading("FocusFlow", size="8"),
            rx.text(
                "Paste a Plaud share link or direct audio URL. Add to create a job.",
                size="2",
                text_align="center",
            ),
            # Input section - stack on mobile
            rx.flex(
                rx.input(
                    placeholder="https://share.plaud.ai/... or .mp3/.m4a",
                    value=AppState.audio_url,
                    on_change=AppState.set_audio_url,
                    width="100%",
                    size="3",  # Larger for touch
                ),
                rx.button(
                    "Add",
                    on_click=AppState.add_job,
                    color_scheme="blue",
                    size="3",  # Larger for touch
                    cursor="pointer",
                    width="100%",
                    style={"cursor": "pointer"},  # Force pointer cursor
                    _hover={"transform": "translateY(-1px)", "boxShadow": "0 3px 10px rgba(0,0,0,0.08)"},
                ),
                direction="column",  # Always stack for mobile-first
                gap="2",
                width="100%",
                max_width="960px",
            ),
            # Status badges - wrap on mobile
            rx.flex(
                rx.badge(rx.text("AssemblyAI: ON"), color_scheme="green", display=rx.cond(AppState.assemblyai_enabled, "inline-flex", "none")),
                rx.badge(rx.text("AssemblyAI: OFF"), color_scheme="red", display=rx.cond(AppState.assemblyai_enabled, "none", "inline-flex")),
                rx.badge(rx.text("GPT: ON"), color_scheme="green", display=rx.cond(AppState.openai_enabled, "inline-flex", "none")),
                rx.badge(rx.text("GPT: OFF"), color_scheme="red", display=rx.cond(AppState.openai_enabled, "none", "inline-flex")),
                gap="2",
                wrap="wrap",
                justify="center",
            ),
            rx.vstack(
                rx.foreach(AppState.jobs, _job_card),
                spacing="3",
                align="stretch",
                width="100%",
                max_width="960px",
            ),
            spacing="4",
            align="center",
            width="100%",
        ),
        min_h="100vh",
        padding="0.75rem",
    )


def job_detail(job_id: str = "") -> rx.Component:
    nav = rx.hstack(
        rx.link(
            rx.button("← Jobs", variant="soft", size="3", cursor="pointer"),
            href="/",
        ),
        width="100%",
        max_width="960px",
        align="start"
    )

    return rx.center(
        rx.vstack(
            # Hidden initializer to trigger load_job immediately
            rx.box(
                on_mount=lambda: AppState.load_job(job_id),
                display="none",
            ),
            nav,
            # Header section
            rx.vstack(
                rx.hstack(
                    rx.heading("Job Detail", size="7"),
                    rx.badge(AppState.current_status, variant="soft", size="2"),
                    rx.spacer(),
                    rx.button("Re-summarize", size="2", on_click=AppState.regenerate_summary, variant="soft", cursor="pointer"),
                    rx.button("Retry", size="2", on_click=AppState.retry_current, variant="soft", cursor="pointer"),
                    rx.button("Delete", size="2", on_click=AppState.delete_current, color_scheme="red", variant="soft", cursor="pointer"),
                    align="center",
                    spacing="3",
                    width="100%",
                ),
                rx.cond(
                    AppState.current_meeting_date,
                    rx.hstack(
                        rx.icon("calendar", size=20),
                        rx.text(f"Meeting Date: {AppState.current_meeting_date}", size="3", weight="medium", color="blue.600"),
                        spacing="1",
                    ),
                    rx.fragment(),
                ),
                spacing="2",
                width="100%",
                max_width="960px",
            ),
            # Transcript section with toggle
            rx.vstack(
                rx.hstack(
                    rx.button(
                        rx.cond(
                            AppState.transcript_open,
                            "▼",
                            "▶"
                        ),
                        " Transcript",
                        size="2",
                        variant="ghost",
                        on_click=AppState.toggle_transcript,
                        cursor="pointer",
                    ),
                    rx.spacer(),
                    rx.button(
                        "Copy",
                        size="2",
                        variant="soft",
                        on_click=rx.set_clipboard(AppState.current_transcript),
                        cursor="pointer",
                    ),
                    width="100%",
                    align="center",
                ),
                rx.cond(
                    AppState.transcript_open,
                    rx.box(
                        rx.text(
                            rx.cond(AppState.current_transcript == "", "(empty)", AppState.current_transcript),
                            white_space="pre-wrap",
                            size="2",
                        ),
                        padding="12px",
                        max_height="45vh",
                        overflow_y="auto",
                        bg="gray.50",
                        border="1px solid",
                        border_color="gray.200",
                        border_radius="6px",
                        width="100%",
                        style={"fontFamily": "ui-monospace, SFMono-Regular, Menlo, monospace"},
                    ),
                ),
                width="100%",
                max_width="960px",
                spacing="2",
                align="start",
            ),
            # Summary section - mobile optimized
            rx.vstack(
                rx.heading("Summary", size="4"),
                rx.box(
                    rx.markdown(
                        rx.cond(
                            AppState.current_summary == "",
                            "*No summary available*",
                            AppState.current_summary
                        ),
                        component_map={
                            "p": lambda text: rx.text(text, size="2", margin_bottom="1em", color="black"),
                            "h1": lambda text: rx.heading(text, size="6", color="black", margin_bottom="0.5em"),
                            "h2": lambda text: rx.heading(text, size="5", color="black", margin_bottom="0.5em"),
                            "h3": lambda text: rx.heading(text, size="4", color="black", margin_bottom="0.5em"),
                            "li": lambda text: rx.text(text, size="2", color="black"),
                        }
                    ),
                    border="1px solid",
                    border_color="gray.200",
                    border_radius="8px",
                    padding="16px",
                    width="100%",
                    min_height="20vh",
                    bg="white",
                    color="black",
                    style={"lineHeight": "1.6", "color": "black"},
                ),
                spacing="2",
                align="start",
                width="100%",
                max_width="960px",
            ),
            # Logs section - mobile optimized
            rx.vstack(
                rx.heading("Pipeline Logs", size="4"),
                rx.box(
                    rx.vstack(
                        rx.foreach(
                            AppState.current_logs,
                            lambda line: rx.code(
                                line,
                                width="100%",
                                size="1",
                                style={"wordBreak": "break-all"},  # Prevent overflow
                            )
                        ),
                        spacing="1",
                        align="start",
                    ),
                    border="1px solid",
                    border_color="gray.300",
                    padding="8px",
                    width="100%",
                    max_height="25vh",
                    overflow_y="auto",
                    overflow_x="auto",  # Allow horizontal scroll if needed
                    bg="gray.50",
                    style={"fontFamily": "ui-monospace, SFMono-Regular, Menlo, monospace"},
                ),
                spacing="2",
                align="start",
                width="100%",
                max_width="960px",
            ),
            spacing="4",
            align="center",
            width="100%",
        ),
        min_h="100vh",
        padding="0.75rem",
    )


def create_app() -> rx.App:
    app = rx.App(
        style={
            rx.button: {
                "cursor": "pointer",
            },
            rx.link: {
                "cursor": "pointer",
            },
        }
    )
    app.add_page(index, route="/", on_load=AppState.hydrate)
    app.add_page(job_detail, route="/job/[job_id]", on_load=AppState.hydrate)
    return app


app = create_app()
def _load_env_from_dotenv(path: str = ".env") -> None:
    try:
        if not os.path.exists(path):
            return
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                os.environ.setdefault(k, v)
    except Exception as e:  # noqa: BLE001
        _log_print("ENV", f"failed to parse .env: {e}")


_load_env_from_dotenv()
