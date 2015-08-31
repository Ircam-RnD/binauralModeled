# BinauralModeled node

> Processing node which spatializes an incoming audio stream in three-dimensional space for binaural audio.

The binauralModeled node provides binaural listening to the user with three simple steps. The novelty of this library is that it permits to use your own modeled HRTF dataset. This node implements the minimum-phase and pure delay synthesis technique. This library can be used as a regular node - AudioNode - inside the [Web Audio API](http://www.w3.org/TR/webaudio/). You can connect the native nodes to the binauralModeled node by using the connect method to binauralModeled.input: 

```js
nativeNode.connect(binauralModeled.input);
binauralModeled.connect(audioContext.destination);
```

We provide a modeled HRTF dataset example provided by [IRCAM](http://www.ircam.fr/) in the /examples/snd/complete_hrtf_modeled.js file.

## Example

A working demo for this module can be found [here](https://ircam-rnd.github.io/binauralModeled/) and in the `examples` folder.

## HRTF dataset format

As this library allow you to use your own modeled [HRTF](http://en.wikipedia.org/wiki/Head-related_transfer_function) Dataset, if you want to use your dataset in the library you have to follow the following format:

Data | Description
--- | ---
`azimuth` | Azimuth in degrees: from 0 to -180 for source on your left, and from 0 to 180 for source on your right
`distance` | Distance in meters
`elevation` | Elevation in degrees: from 0 to 90 for source above your head, 0 for source in front of your head, and from 0 to -90 for source below your head)
`itd` | Delay value in ms. The left delay and right delay are calculated as: "left delay = offset + ITD / 2" and "right delay = offset - ITD / 2" where offset is an offset to guarantee that the delays are positive (casual).
`iir_coeffs_left` | Array of biquad coefficients for the left ear. 
`iir_coeffs_right` | Array of biquad coefficients for the right ear. 

This data must be provided inside an Array of Objects, like this example:

```js
[
  {
    'azimuth': 0,
    'distance': 1,
    'elevation': -40,
    'itd': 0,
    'iir_coeffs_left': [
      0.65549,
      -1.7477,
      0.88655,
      -1.7006,
      0.83541,
      -1.2725,
      0.85948,
      -1.3682,
      0.71943,
      -1.9479,
      0.95212,
      -1.9484,
      0.95334,
      -1.9382,
      0.96228,
      -1.9422,
      0.96604,
      -0.53165,
      0.8805,
      -0.7819,
      0.78236,
      -0.14235,
      0.43518,
      0.10004,
      0.78684,
    ],
    'iir_coeffs_right': [
      0.65549,
      -1.7477,
      0.88655,
      -1.7006,
      0.83541,
      -1.2725,
      0.85948,
      -1.3682,
      0.71943,
      -1.9479,
      0.95212,
      -1.9484,
      0.95334,
      -1.9382,
      0.96228,
      -1.9422,
      0.96604,
      -0.53165,
      0.8805,
      -0.7819,
      0.78236,
      -0.14235,
      0.43518,
      0.10004,
      0.78684,
    ]
  }
]
```

## API

The `binauralModeled` object exposes the following API:

Method | Description
--- | ---
`binauralModeled.connect()` | Connects the binauralModeledNode to the Web Audio graph
`binauralModeled.disconnect()` | Disconnect the binauralModeledNode from the Web Audio graph
`binauralModeled.HRTFDataset` | Set the modeled HRTF Dataset to be used with the virtual source.
`binauralModeled.setPosition(azimuth, elevation, distance)` | Set the position of the virtual source.
`binauralModeled.getPosition()` | Get the current position of the virtual source.
`binauralModeled.setCrossfadeDuration(duration)` | Set the duration of crossfading in miliseconds.
`binauralModeled.getCrossfadeDuration()` | Get the duration of crossfading in miliseconds.

## Tests

Install all depencies in the module folder

```bash
$ npm install
$ npm run test
```

Run the test via the web browser.

## License

This module is released under the [BSD-3-Clause license](http://opensource.org/licenses/BSD-3-Clause).

## Acknowledgments

This code has been developed from both [Acoustic And Cognitive Spaces](http://recherche.ircam.fr/equipes/salles/) and [Analysis of Musical Practices](http://apm.ircam.fr) IRCAM research teams. It is also part of the WAVE project (http://wave.ircam.fr), funded by ANR (The French National Research Agency), ContInt program, 2012-2015.
