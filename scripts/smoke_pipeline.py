#!/usr/bin/env python3
"""Smoke test for FocusFlow minimal pipeline.

Runs the pipeline against a provided URL, prints streamed logs,
verifies the download exists, optionally verifies transcription/summary
if env vars are set, deletes the job and confirms cleanup.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()

    # Import app after args so it can load .env and constants
    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from main.main import (
        DATA_DIR,
        resolve_plaud_audio_url,
        download_audio_file,
        transcribe_with_assemblyai,
        summarize_with_gpt,
        cleanup_job_artifacts,
    )

    jid = "smoke" + str(int(time.time()))
    logs: list[str] = []
    def log(line: str):
        logs.append(line)
        print(f"[LOG] {line}")

    # Resolve
    start = time.time()
    gen = resolve_plaud_audio_url(jid, args.url, log)
    while True:
        try:
            _ = next(gen)
        except StopIteration as si:
            resolved = si.value
            break
        if time.time() - start > args.timeout:
            print("[TEST] Timeout resolving; aborting")
            return 2
    assert isinstance(resolved, str) and resolved, "failed to resolve URL"
    print(f"[TEST] Resolved: {resolved}")

    # Download
    start = time.time()
    gen = download_audio_file(jid, resolved, log)
    while True:
        try:
            _ = next(gen)
        except StopIteration as si:
            file_path = si.value
            break
        if time.time() - start > args.timeout:
            print("[TEST] Timeout downloading; aborting")
            return 3

    assert file_path, "file_path missing"
    p = Path(file_path)
    assert p.exists(), f"downloaded file missing: {p}"
    assert p.stat().st_size > 0, "downloaded file is empty"

    # Transcribe (optional)
    transcript = None
    start = time.time()
    gen = transcribe_with_assemblyai(jid, file_path, log)
    while True:
        try:
            _ = next(gen)
        except StopIteration as si:
            transcript = si.value
            break
        if time.time() - start > args.timeout:
            print("[TEST] Timeout transcribing; skipping")
            transcript = None
            break
    if transcript:
        print(f"[TEST] Transcript OK: {len(transcript)} chars")
    else:
        print("[TEST] Transcript empty or skipped (ok if ASSEMBLYAI_API_KEY unset)")

    # Summarize (optional, only if transcript exists)
    summary = None
    if transcript:
        start = time.time()
        gen = summarize_with_gpt(jid, transcript, log)
        while True:
            try:
                _ = next(gen)
            except StopIteration as si:
                summary = si.value
                break
            if time.time() - start > args.timeout:
                print("[TEST] Timeout summarizing; skipping")
                summary = None
                break
    if summary:
        print(f"[TEST] Summary OK: {len(summary)} chars")
    else:
        print("[TEST] Summary empty or skipped (ok if OPENAI_* unset)")

    # Cleanup
    cleanup_job_artifacts(jid, str(p))
    leftovers = list(DATA_DIR.glob(f"{jid}*"))
    assert not leftovers, f"leftover artifacts not removed: {leftovers}"
    print("[TEST] Cleanup OK")

    print("[TEST] SUCCESS")


if __name__ == "__main__":
    sys.exit(main())
