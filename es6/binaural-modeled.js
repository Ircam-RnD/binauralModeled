/**
 * @fileOverview
 *
 * @author Arnau Julià <Arnau.Julia@gmail.com>
 * @version 0.1.0
 */
import kdt from 'kdt';
import BiquadFilter from 'biquad-filter';
import FractionalDelay from 'fractional-delay';


/**
 * @class BinauralModeled
 */
export default class BinauralModeled {
  /**
   * Constructor
   */
  constructor(options) {
    this.audioContext = options.audioContext;
    // Private properties
    this.hrtfDataset = undefined;
    this.hrtfDatasetLength = undefined;
    this.nextPosition = [];
    this.changeWhenFinishCrossfading = false;
    this.position = [];
    this.crossfadeDuration = 20 / 1000;
    this.bufferSize = 1024;
    this.tree = -1;

    this.input = this.audioContext.createGain();

    this.state = "A"; // States in ["A", "B", "A2B", "B2A"]
    this.target = undefined;
    this.pendingPosition = undefined;
    this.convolverA = new ProcessingAudioGraph({
      audioContext: this.audioContext
    });
    this.convolverA.gain.value = 1;
    this.input.connect(this.convolverA.input);
    this.convolverB = new ProcessingAudioGraph({
      audioContext: this.audioContext
    });
    this.convolverB.gain.value = 0;
    this.input.connect(this.convolverB.input);
    this.sampleRate = this.audioContext.sampleRate;
  }

  /**
   * Connects the binauralModeledNode to the Web Audio graph
   * @public
   * @param node Destination node
   */
  connect(node) {
    // this.mainAudioGraph.connect(node);
    // this.secondaryAudioGraph.connect(node);
    this.convolverA.connect(node);
    this.convolverB.connect(node);
    return this;
  }

  /**
   * Disconnect the binauralModeledNode from the Web Audio graph
   * @public
   * @param node Destination node
   */
  disconnect(node) {
    // this.mainAudioGraph.disconnect(node);
    // this.secondaryAudioGraph.disconnect(node);
    this.convolverA.disconnect(node);
    this.convolverB.disconnect(node);
    return this;
  }

  /**
   * Set HRTF Dataset to be used with the virtual source.
   * @public
   * @param hrtfDataset Array of Objects containing the azimuth, distance, elevation, url and buffer for each point
   */
  set HRTFDataset(hrtfDataset) {
    this.hrtfDataset = hrtfDataset;
    this.hrtfDatasetLength = this.hrtfDataset.length;

    for (var i = 0; i < this.hrtfDatasetLength; i++) {
      var hrtf = this.hrtfDataset[i];
      // Azimuth and elevation to radians
      var azimuthRadians = hrtf.azimuth * Math.PI / 180;
      var elevationRadians = hrtf.elevation * Math.PI / 180;
      var catesianCoord = this.sphericalToCartesian(azimuthRadians, elevationRadians, hrtf.distance);
      hrtf.x = catesianCoord.x;
      hrtf.y = catesianCoord.y;
      hrtf.z = catesianCoord.z;
    }
    this.tree = kdt.createKdTree(this.hrtfDataset, this.distance, ['x', 'y', 'z']);

    // Put default values
    var hrtfNextPosition = this.getHRTF(0, 0, 1);
    this.convolverB.setCoefficients(hrtfNextPosition.iir_coeffs_left, hrtfNextPosition.iir_coeffs_right);
    this.convolverB.setDelay(hrtfNextPosition.itd / 1000);
    this.convolverA.setCoefficients(hrtfNextPosition.iir_coeffs_left, hrtfNextPosition.iir_coeffs_right);
    this.convolverA.setDelay(hrtfNextPosition.itd / 1000);
  }
  get HRTFDataset() {
    return this.hrtfDataset;
  }

  /**
   * Calculate the distance between two points in a 3-D space.
   * @private
   * @param a Object containing three properties: x, y, z
   * @param b Object containing three properties: x, y, z
   */
  distance(a, b) {
    // No need to compute square root here for distance comparison, this is more eficient.
    return Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + Math.pow(a.z - b.z, 2);
  }

  /**
   * Set position of the virtual source
   * @public
   * @param azimuth Azimuth in degrees (°): from 0 to -180 for source on your left, and from 0 to 180 for source on your right
   * @param elevation Elevation in degrees (°): from 0 to 90 for source above your head, 0 for source in front of your head, and from 0 to -90 for source below your head)
   * @param distance Distance in meters
   */
  setPosition(azimuth, elevation, distance) {
    // Calculate the nearest position for the input azimuth, elevation and distance
    var nearestPosition = this.getRealCoordinates(azimuth, elevation, distance);
    if (nearestPosition.azimuth !== this.position.azimuth || nearestPosition.elevation !== this.position.elevation || nearestPosition.distance !== this.position.distance) {
      switch (this.state) {
        case "A":
          this.state = "A2B";
          this.pendingPosition = undefined;
          this._crossfadeTo("B", nearestPosition);
          break;
        case "B":
          this.state = "B2A";
          this.pendingPosition = undefined;
          this._crossfadeTo("A", nearestPosition);
          break;
        case "A2B":
          this.pendingPosition = nearestPosition;
          break;
        case "B2A":
          this.pendingPosition = nearestPosition;
          break;
      }
    }
  }

  _crossfadeTo(target, position) {
    // Set the new target position
    this.position = position;
    this.target = target;
    let hrtf = this.getHRTF(this.position.azimuth, this.position.elevation, this.position.distance);
    let now = this.audioContext.currentTime;
    let next = now + this.crossfadeDuration;
    switch (this.target) {
      case "A":
        this.convolverA.setCoefficients(hrtf.iir_coeffs_left, hrtf.iir_coeffs_right);
        this.convolverA.setDelay(hrtf.itd / 1000);
        this.convolverB.gain.linearRampToValueAtTime(0, next);
        this.convolverA.gain.linearRampToValueAtTime(1, next);
        break;
      case "B":
        this.convolverB.setCoefficients(hrtf.iir_coeffs_left, hrtf.iir_coeffs_right);
        this.convolverB.setDelay(hrtf.itd / 1000);
        this.convolverA.gain.linearRampToValueAtTime(0, next);
        this.convolverB.gain.linearRampToValueAtTime(1, next);
        break;
    }
    // Trigger event when linearRamp is reached
    function endRamp(tg) {
      if (tg.audioContext.currentTime > next) {
        window.clearInterval(intervalID);
        // Target state is reached
        tg.state = tg.target;
        tg.target = undefined;
        // Trigger if there is a pending position
        if (tg.pendingPosition) {
          tg.setPosition(tg.pendingPosition.azimuth, tg.pendingPosition.elevation, tg.pendingPosition.distance);
        }
      }
    }
    let intervalID = window.setInterval(endRamp, 10, this);
  }

  /**
   * Get the current position of the virtual source.
   * @public
   */
  getPosition() {
    return this.position;
  }

  /**
   * Pause playing.
   * @public
   */
  setCrossfadeDuration(msRamp) {
    //save in seconds
    this.crossfadeDuration = msRamp / 1000;
  }

  /**
   * Seek buffer position (in sec).
   * @public
   */
  getCrossfadeDuration() {
    //return in ms
    return this.crossfadeDuration * 1000;
  }

  /**
   * Get the HRTF file for an especific position
   * @private
   * @param azimuth Azimuth in degrees (°): from 0 to -180 for source on your left, and from 0 to 180 for source on your right
   * @param elevation Elevation in degrees (°): from 0 to 90 for source above your head, 0 for source in front of your head, and from 0 to -90 for source below your head)
   * @param distance Distance in meters
   */
  getHRTF(azimuth, elevation, distance) {
    var nearest = this.getNearestPoint(azimuth, elevation, distance);
    var hrtf = [];
    hrtf.iir_coeffs_left = nearest.iir_coeffs_left;
    hrtf.iir_coeffs_right = nearest.iir_coeffs_right;
    hrtf.itd = nearest.itd;

    // Return hrtf data of nearest position for the input values
    return hrtf;
  }

  /**
   * Transform the spherical to cartesian coordinates.
   * @private
   * @param azimuth Azimuth in radians
   * @param elevation Elevation in radians
   * @param distance Distance in meters
   */
  sphericalToCartesian(azimuth, elevation, distance) {
    return {
      x: distance * Math.sin(azimuth),
      y: distance * Math.cos(azimuth),
      z: distance * Math.sin(elevation)
    };
  }

  /**
   * Get the nearest position for an input position.
   * @private
   * @param azimuth Azimuth in degrees (°): from 0 to -180 for source on your left, and from 0 to 180 for source on your right
   * @param elevation Elevation in degrees (°): from 0 to 90 for source above your head, 0 for source in front of your head, and from 0 to -90 for source below your head)
   * @param distance Distance in meters
   */
  getRealCoordinates(azimuth, elevation, distance) {
    var nearest = this.getNearestPoint(azimuth, elevation, distance);
    // Return azimuth, elevation and distance of nearest position for the input values
    return {
      azimuth: nearest.azimuth,
      elevation: nearest.elevation,
      distance: nearest.distance
    };
  }

  /**
   * Get the nearest position for an input position.
   * @private
   * @param azimuth Azimuth in degrees (°): from 0 to -180 for source on your left, and from 0 to 180 for source on your right
   * @param elevation Elevation in degrees (°): from 0 to 90 for source above your head, 0 for source in front of your head, and from 0 to -90 for source below your head)
   * @param distance Distance in meters
   */
  getNearestPoint(azimuth, elevation, distance) {
    // Degrees to radians for the azimuth and elevation
    var azimuthRadians = azimuth * Math.PI / 180;
    var elevationRadians = elevation * Math.PI / 180;
    // Convert spherical coordinates to cartesian
    var cartesianCoord = this.sphericalToCartesian(azimuthRadians, elevationRadians, distance);
    // Get the nearest HRTF file for the desired position
    var nearest = this.tree.nearest(cartesianCoord, 1)[0];

    return nearest[0];
  }
}


/**
 * AudioGraph sub audio graph object as an ECMAScript5 properties object.
 */
class ProcessingAudioGraph {
  constructor(options) {
    this.audioContext = options.audioContext;
    // Private properties
    this.bufferSize = 1024;

    // Creations
    this.input = this.audioContext.createGain();
    this.gainNode = this.audioContext.createGain();
    this.biquadFilterLeft = new BiquadFilter();
    this.biquadFilterRight = new BiquadFilter();
    this.fractionalDelayLeft = new FractionalDelay(44100);
    this.fractionalDelayRight = new FractionalDelay(44100);
    this.processorNode = this.audioContext.createScriptProcessor(this.bufferSize);
    // Connections
    this.input.connect(this.processorNode);
    this.processorNode.connect(this.gainNode);
    // Start processorNode
    this.processorNodeFunction();
  }

  get gain() {
    return this.gainNode.gain;
  }

  /**
   * Set coefficients biquad filter
   * @public
   * @param value AudioBuffer Object.
   */
  setCoefficients(leftCoefficients, rightCoefficients) {
    this.biquadFilterLeft.setCoefficients(leftCoefficients);
    this.biquadFilterRight.setCoefficients(rightCoefficients);
  }

  /**
   * Set buffer and bufferDuration.
   * @public
   * @chainable
   */
  setDelay(delay) {
    var delayLeft = 1 / 1000 + delay / 2;
    var delayRight = 1 / 1000 - delay / 2;
    this.fractionalDelayLeft.setDelay(delayLeft);
    this.fractionalDelayRight.setDelay(delayRight);
  }

  processorNodeFunction() {
    var that = this;
    this.processorNode.onaudioprocess = function(e) {
      // Get the inputBuffer
      var inputArray = e.inputBuffer.getChannelData(0);

      // Get the outputBuffers
      var leftOutputArray = e.outputBuffer.getChannelData(0);
      var rightOutputArray = e.outputBuffer.getChannelData(1);

      // Delay
      var mediumArrayLeft = new Float32Array(that.fractionalDelayLeft.process(inputArray));
      var mediumArrayRight = new Float32Array(that.fractionalDelayRight.process(inputArray));

      // BiquadFilter
      that.biquadFilterLeft.process(mediumArrayLeft, leftOutputArray);
      that.biquadFilterRight.process(mediumArrayRight, rightOutputArray);
    };
  }

  /**
   * Connect the convolverAudioGraph to a node
   * @public
   * @chainable
   * @param node Destination node
   */
  connect(node) {
    this.gainNode.connect(node);
    return this;
  }

  /**
   * Disconnect the convolverAudioGraph to a node
   * @public
   * @chainable
   * @param node Destination node
   */
  disconnect(node) {
    this.gainNode.disconnect(node);
    return this;
  }
}
