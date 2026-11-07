# FFmpeg runtime and corresponding source

The Windows beta launches FFmpeg and ffprobe as separate executables. They are supplied by [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds), not covered by ClipClap's Apache-2.0 license. The pinned `win64-gpl-9.0` build uses GPL-3.0-or-later; its license is included beside the executables under `resources/ffmpeg/LICENSE.txt`.

The exact binary URL, checksum, FFmpeg commit, build-recipe commit and source-cache artifact digest are recorded in [scripts/clipclap-ffmpeg.json](../../scripts/clipclap-ffmpeg.json). Prepare the verified binaries with:

```sh
python scripts/prepare-clipclap-ffmpeg.py
```

The [beta release](https://github.com/guardyanz/clipclap/releases/tag/v0.1.0-beta.1) also hosts the matching build's `download-cache` source archive, split into `ffmpeg-source-cache.zip.001` and `.002` to fit GitHub's asset-size limit, together with the pinned build recipes. These are source downloads, not required to run ClipClap. Join both parts in order to recover the original ZIP; its SHA-256 is `69b13345ab4f4ab491ff3afce0711d4b7f648dab2a96213ffad23e0481abe7ff`.

```sh
# POSIX shell
cat ffmpeg-source-cache.zip.001 ffmpeg-source-cache.zip.002 > ffmpeg-source-cache.zip
```

On Windows, join the two files in order using Python's `shutil.copyfileobj` with a binary output file. Extract the recovered ZIP and the build-recipe archive, then follow the pinned recipes' README for the `win64 gpl 9.0` variant. The cache contains the upstream source downloads used by that build, including dependency sources; the recipes specify build options and patches. Preserve the included notices when redistributing these runtimes.
