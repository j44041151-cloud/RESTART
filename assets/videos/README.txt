RE:START — THE LAST SIGNAL · Opening cinematic
================================================

Place the official opening cinematic here, named exactly:

    restart_intro.mp4

The game plays it fullscreen from the New Game button:
- narration audio comes from the video track (deep male narration)
- subtitles are drawn by the game from js/story/Story.js (INTRO_NARRATION)
- SKIP button, Escape, Enter or Space ends it immediately
- if the file is absent or cannot decode, the game shows a styled fallback
  reel with the same narration instead of a black screen

The local server (server.ps1) already serves .mp4 as video/mp4.

No placeholder video is included on purpose — only a real cinematic should be
dropped in here.
