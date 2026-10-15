# Wait! A computer can do that?

A set of five small demos I made for a talk series. Each one does something that looks a bit impossible at first, and then we take it apart to see how it works.

Live version: https://reyaattri.github.io/Wait-A-Computer-Can-Do-That-/

Everything runs in the browser. There's no server and nothing to install.

## The demos

**01. I taught pixels to heal themselves**
You plant one cell and it grows into a lizard. Cut it in half and it grows back. Every pixel runs the same tiny neural network and only looks at its 8 neighbours, so there's no "master plan" anywhere. I trained it with PyTorch, based on the [Growing Neural Cellular Automata](https://distill.pub/2020/growing-ca/) paper.

**02. I hid a ZIP file inside a cat**
A normal-looking cat picture that is also a working ZIP file. Image viewers read a JPEG from the start and stop at the end marker. ZIP tools read from the end, where the file list is. So you can stick a ZIP onto the end of a JPEG and both still work.

**03. My browser tabs are talking behind my back**
Open the page in a few windows side by side and they find each other, draw lines between themselves, share cursors and pass a ball around. It uses the BroadcastChannel API, so it works even with Wi-Fi off.

**04. I hid a picture inside a sound**
It sounds like static, but if you look at the spectrogram there's text in it. Each row of the image becomes a tone and each column is a moment in time. You can play the .wav from your phone into the laptop mic and the picture still shows up.

**05. I turned my face into a math problem**
Take a selfie and it gets turned into dots, then into one continuous line. Finding the shortest path through all the dots is the travelling salesperson problem. It starts with a rough path and keeps untangling crossed lines until it can't get any shorter.

## Running it locally

```bash
git clone https://github.com/reyaattri/Wait-A-Computer-Can-Do-That-.git
cd Wait-A-Computer-Can-Do-That-
python -m http.server 8800
```

Then go to http://localhost:8800. On Windows you can also just double-click `START.bat`.

You need a local server rather than opening the HTML file directly, because browsers only allow the camera, mic and web workers on localhost or https.

## Keyboard shortcuts

- `N` opens my presenter notes
- `P` hides the side panel
- `F` goes fullscreen

Each demo has a few more, listed in its notes.

## Training your own creature for demo 01

```bash
pip install torch numpy pillow
python 01-healing-pixels/train/train_nca.py --emoji 🍄 --name mushroom --steps 4000
```

It's much faster on a GPU (and with the laptop plugged in). The page will pick up `lizard`, `butterfly`, `mushroom` or `heart` from the `weights` folder.

## Privacy

Photos, sounds and files you use stay on your device. Demo 05 saves your last photo in your browser's local storage so it survives a refresh. Picking one of the emoji samples clears it.

## Credits

- Mordvintsev, Randazzo, Niklasson and Levin for the neural cellular automata paper
- Adrian Secord for weighted Voronoi stippling
- Robert Bosch and Craig Kaplan for TSP art
- Aphex Twin for hiding his face in a song back in 1999
- Ange Albertini for his work on polyglot files

Made by Reya Attri.
