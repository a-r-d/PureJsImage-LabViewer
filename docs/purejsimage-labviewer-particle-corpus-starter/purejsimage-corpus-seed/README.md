# PureJsImage LabViewer corpus seed

This archive contains nine exact files that are safe to use as a small integration seed. It is deliberately not presented as the final scientific benchmark.

## Included material

- Two BBBC039 image and instance-mask preview pairs for touching nuclei and heterogeneous intensity.
- One BBBC005 in-focus, out-of-focus, and ground-truth trio.
- One NIST asbestos SEM montage with six panels, multiple scale bars, labels, crossing fibers, debris, and multiple magnifications.
- One public-domain USGS anthophyllite asbestos SEM image.

## Important limits

- The BBBC files here are web preview PNGs. The final benchmark should fetch the native 16-bit TIFFs and native labels.
- The asbestos images have no upstream masks. They are smoke tests until a reviewed mask and an explicit measurement policy are added.
- Do not evaluate scientific correctness from total count alone.
- Keep scale-bar pixels, panel dividers, text, and image borders out of the object mask.
- Record every crop, resize, intensity conversion, and mask edit in the corpus manifest.

## License and attribution

- BBBC039 is CC0. Source: https://bbbc.broadinstitute.org/BBBC039
- BBBC005 states that the copyright is waived to the extent possible. Source: https://bbbc.broadinstitute.org/BBBC005
- NIST data and works covered by the NIST open-data statement may be redistributed and modified royalty-free with acknowledgement and modification notices. Source: https://www.nist.gov/open/license
- `Anthophyllite_asbestos_SEM.jpg` is a United States Geological Survey work identified as public domain. Source page: https://commons.wikimedia.org/wiki/File:Anthophyllite_asbestos_SEM.jpg

The precise source URL, local checksum, role, dimensions, and intended tasks for each file are in `manifest.json`.
