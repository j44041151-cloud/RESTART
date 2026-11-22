RE:START — THE LAST SIGNAL · Opening cinematic
================================================

Place the official opening cinematic here, named exactly:

    restart_intro.mp4

How the game uses it:
- on the first launch of a browser session it plays full-screen, letterboxed
  (original aspect ratio preserved), before the main menu appears
- a small loading indicator shows while the video buffers
- SKIP INTRO (top right) or Escape / Enter / Space ends it and returns to the
  main menu; the video ending does the same — gameplay never starts by itself
- the main menu has REPLAY CINEMATIC to watch it again
- if the browser blocks autoplay with sound, a PLAY CINEMATIC button appears
- if the file is absent or cannot be decoded, the game shows a short
  "CINEMATIC UNAVAILABLE" card and continues to the main menu

The local server (server.ps1) already serves .mp4 as video/mp4.

restart_intro.mp4 is the real 40 second, 1920x1080, H.264/AAC opening
cinematic, included with the game. Replace it with another H.264 .mp4 of the
same name to swap the opening; a missing file simply skips the cinematic.
