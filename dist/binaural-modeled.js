/**
 * @fileOverview
 *
 * @author Arnau Julià <Arnau.Julia@gmail.com>
 * @version 0.1.0
 */
'use strict';

var _createClass = require('babel-runtime/helpers/create-class')['default'];

var _classCallCheck = require('babel-runtime/helpers/class-call-check')['default'];

var _interopRequireDefault = require('babel-runtime/helpers/interop-require-default')['default'];

Object.defineProperty(exports, '__esModule', {
  value: true
});

var _kdt = require('kdt');

var _kdt2 = _interopRequireDefault(_kdt);

var _biquadFilter = require('biquad-filter');

var _biquadFilter2 = _interopRequireDefault(_biquadFilter);

var _fractionalDelay = require('fractional-delay');

var _fractionalDelay2 = _interopRequireDefault(_fractionalDelay);

/**
 * @class BinauralModeled
 */

var BinauralModeled = (function () {
  /**
   * Mandatory initialization method.
   * @public
   * @chainable
   */

  function BinauralModeled(options) {
    _classCallCheck(this, BinauralModeled);

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

    // Two sub audio graphs creation:
    // - mainConvolver which represents the current state
    // - and secondaryConvolver which represents the potential target state
    //   when moving sound to a new position

    this.mainAudioGraph = new ProcessingAudioGraph({
      audioContext: this.audioContext
    });
    this.mainAudioGraph.gain.value = 1;
    this.input.connect(this.mainAudioGraph.input);

    this.secondaryAudioGraph = new ProcessingAudioGraph({
      audioContext: this.audioContext
    });
    this.secondaryAudioGraph.gain.value = 0;
    this.input.connect(this.secondaryAudioGraph.input);
    // Web Audio
    this.sampleRate = this.audioContext.sampleRate;
    //Connections
    this.input.connect(this.mainAudioGraph.input);
    this.input.connect(this.secondaryAudioGraph.input);
  }

  /**
   * AudioGraph sub audio graph object as an ECMAScript5 properties object.
   */

  /**
   * Connects the binauralModeledNode to the Web Audio graph
   * @public
   * @chainable
   * @param node Destination node
   */

  _createClass(BinauralModeled, [{
    key: 'connect',
    value: function connect(node) {
      this.mainAudioGraph.connect(node);
      this.secondaryAudioGraph.connect(node);
      return this; // For chainability
    }

    /**
     * Disconnect the binauralModeledNode from the Web Audio graph
     * @public
     * @chainable
     * @param node Destination node
     */
  }, {
    key: 'disconnect',
    value: function disconnect(node) {
      this.mainAudioGraph.disconnect(node);
      this.secondaryAudioGraph.disconnect(node);
      return this; // For chainability
    }

    /**
     * Set HRTF Dataset to be used with the virtual source.
     * @public
     * @chainable
     * @param hrtfDataset Array of Objects containing the azimuth, distance, elevation, url and buffer for each point
     */
  }, {
    key: 'distance',

    /**
     * Calculate the distance between two points in a 3-D space.
     * @private
     * @chainable
     * @param a Object containing three properties: x, y, z
     * @param b Object containing three properties: x, y, z
     */
    value: function distance(a, b) {
      // No need to compute square root here for distance comparison, this is more eficient.
      return Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + Math.pow(a.z - b.z, 2);
    }

    /**
     * Set gain value and squared volume.
     * @private
     * @chainable
     * @todo : realment va aquí això?
     */
  }, {
    key: 'setLastPosition',
    value: function setLastPosition() {
      if (!this.isCrossfading()) {
        this.changeWhenFinishCrossfading = false;
        clearInterval(this.intervalID);
        this.reallyStartPosition();
      }
    }

    /**
     * Crossfading
     * @private
     * @chainable
     */
  }, {
    key: 'crossfading',
    value: function crossfading() {
      // Do the crossfading between mainAudioGraph and secondaryAudioGraph
      var now = this.audioContext.currentTime;
      // Wait two buffers until do the change (scriptProcessorNode only update the variables at the first sample of the buffer)
      this.mainAudioGraph.gain.setValueAtTime(1, now + 2 * this.bufferSize / this.sampleRate);
      this.mainAudioGraph.gain.linearRampToValueAtTime(0, now + this.crossfadeDuration + 2 * this.bufferSize / this.sampleRate);

      this.secondaryAudioGraph.gain.setValueAtTime(0, now + 2 * this.bufferSize / this.sampleRate);
      this.secondaryAudioGraph.gain.linearRampToValueAtTime(1, now + this.crossfadeDuration + 2 * this.bufferSize / this.sampleRate);
    }

    /**
     * Set position of the virtual source
     * @public
     * @chainable
     * @param azimuth Azimuth in degrees (°): from 0 to -180 for source on your left, and from 0 to 180 for source on your right
     * @param elevation Elevation in degrees (°): from 0 to 90 for source above your head, 0 for source in front of your head, and from 0 to -90 for source below your head)
     * @param distance Distance in meters
     */
  }, {
    key: 'setPosition',
    value: function setPosition(azimuth, elevation, distance) {

      if (arguments.length === 3) {
        // Calculate the nearest position for the input azimuth, elevation and distance
        var nearestPosition = this.getRealCoordinates(azimuth, elevation, distance);
        // No need to change the current HRTF loaded if setted position equal current position
        if (nearestPosition.azimuth !== this.position.azimuth || nearestPosition.elevation !== this.position.elevation || nearestPosition.distance !== this.position.distance) {
          // Check if the crossfading is active
          if (this.isCrossfading() === true) {
            // Check if there is a value waiting to be set
            if (this.changeWhenFinishCrossfading === true) {
              // Stop the past setInterval event.
              clearInterval(this.intervalID);
            } else {
              this.changeWhenFinishCrossfading = true;
            }

            // Save the position
            this.nextPosition.azimuth = nearestPosition.azimuth;
            this.nextPosition.elevation = nearestPosition.elevation;
            this.nextPosition.distance = nearestPosition.distance;

            // Start the setInterval: wait until the crossfading is finished.
            this.intervalID = window.setInterval(this.setLastPosition.bind(this), 0.005);
          } else {
            this.nextPosition.azimuth = nearestPosition.azimuth;
            this.nextPosition.elevation = nearestPosition.elevation;
            this.nextPosition.distance = nearestPosition.distance;
            this.reallyStartPosition();
          }
          return this; // For chainability
        }
      }
    }

    /**
     * Really change the position
     * @private
     */
  }, {
    key: 'reallyStartPosition',
    value: function reallyStartPosition() {
      // Save the current position
      this.position.azimuth = this.nextPosition.azimuth;
      this.position.elevation = this.nextPosition.elevation;
      this.position.distance = this.nextPosition.distance;

      var hrtfNextPosition = this.getHRTF(this.position.azimuth, this.position.elevation, this.position.distance);
      // Load the new position in the biquad and delay not active (secondaryAudioGraph)
      this.secondaryAudioGraph.setCoefficients(hrtfNextPosition.iir_coeffs_left, hrtfNextPosition.iir_coeffs_right);
      this.secondaryAudioGraph.setDelay(hrtfNextPosition.itd / 1000);

      // Do the crossfading between mainAudioGraph and secondaryAudioGraph
      this.crossfading();

      // Change current mainAudioGraph
      var active = this.mainAudioGraph;
      this.mainAudioGraph = this.secondaryAudioGraph;
      this.secondaryAudioGraph = active;
    }

    /**
     * Get the current position of the virtual source.
     * @public
     */
  }, {
    key: 'getPosition',
    value: function getPosition() {
      return this.position;
    }

    /**
     * Pause playing.
     * @public
     */
  }, {
    key: 'setCrossfadeDuration',
    value: function setCrossfadeDuration(msRamp) {
      //save in seconds
      this.crossfadeDuration = msRamp / 1000;
    }

    /**
     * Seek buffer position (in sec).
     * @public
     */
  }, {
    key: 'getCrossfadeDuration',
    value: function getCrossfadeDuration() {
      //return in ms
      return this.crossfadeDuration * 1000;
    }

    /**
     * Release playing flag when the end of the buffer is reached.
     * @public
     * @todo Handle speed changes.
     */
  }, {
    key: 'isCrossfading',
    value: function isCrossfading() {
      // The ramps are not finished, so the crossfading is not finished
      if (this.mainAudioGraph.gain.value !== 1) {
        return true;
      } else {
        return false;
      }
    }

    /**
     * Get the HRTF file for an especific position
     * @private
     * @param azimuth Azimuth in degrees (°): from 0 to -180 for source on your left, and from 0 to 180 for source on your right
     * @param elevation Elevation in degrees (°): from 0 to 90 for source above your head, 0 for source in front of your head, and from 0 to -90 for source below your head)
     * @param distance Distance in meters
     */
  }, {
    key: 'getHRTF',
    value: function getHRTF(azimuth, elevation, distance) {
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
  }, {
    key: 'sphericalToCartesian',
    value: function sphericalToCartesian(azimuth, elevation, distance) {
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
  }, {
    key: 'getRealCoordinates',
    value: function getRealCoordinates(azimuth, elevation, distance) {
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
  }, {
    key: 'getNearestPoint',
    value: function getNearestPoint(azimuth, elevation, distance) {
      // Degrees to radians for the azimuth and elevation
      var azimuthRadians = azimuth * Math.PI / 180;
      var elevationRadians = elevation * Math.PI / 180;
      // Convert spherical coordinates to cartesian
      var cartesianCoord = this.sphericalToCartesian(azimuthRadians, elevationRadians, distance);
      // Get the nearest HRTF file for the desired position
      var nearest = this.tree.nearest(cartesianCoord, 1)[0];

      return nearest[0];
    }
  }, {
    key: 'HRTFDataset',
    set: function set(hrtfDataset) {
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
      this.tree = _kdt2['default'].createKdTree(this.hrtfDataset, this.distance, ['x', 'y', 'z']);

      // Put default values
      var hrtfNextPosition = this.getHRTF(0, 0, 1);
      this.secondaryAudioGraph.setCoefficients(hrtfNextPosition.iir_coeffs_left, hrtfNextPosition.iir_coeffs_right);
      this.secondaryAudioGraph.setDelay(hrtfNextPosition.itd / 1000);
      this.mainAudioGraph.setCoefficients(hrtfNextPosition.iir_coeffs_left, hrtfNextPosition.iir_coeffs_right);
      this.mainAudioGraph.setDelay(hrtfNextPosition.itd / 1000);
    },
    get: function get() {
      return this.hrtfDataset;
    }
  }]);

  return BinauralModeled;
})();

exports['default'] = BinauralModeled;

var ProcessingAudioGraph = (function () {
  function ProcessingAudioGraph(options) {
    _classCallCheck(this, ProcessingAudioGraph);

    this.audioContext = options.audioContext;
    // Private properties
    this.bufferSize = 1024;

    // Creations
    this.input = this.audioContext.createGain();
    this.gainNode = this.audioContext.createGain();
    this.biquadFilterLeft = new _biquadFilter2['default']();
    this.biquadFilterRight = new _biquadFilter2['default']();
    this.fractionalDelayLeft = new _fractionalDelay2['default'](44100);
    this.fractionalDelayRight = new _fractionalDelay2['default'](44100);
    this.processorNode = this.audioContext.createScriptProcessor(this.bufferSize);
    // Connections
    this.input.connect(this.processorNode);
    this.processorNode.connect(this.gainNode);
    // Start processorNode
    this.processorNodeFunction();
  }

  _createClass(ProcessingAudioGraph, [{
    key: 'setCoefficients',

    /**
     * Set coefficients biquad filter
     * @public
     * @param value AudioBuffer Object.
     */
    value: function setCoefficients(leftCoefficients, rightCoefficients) {
      this.biquadFilterLeft.setCoefficients(leftCoefficients);
      this.biquadFilterRight.setCoefficients(rightCoefficients);
    }

    /**
     * Set buffer and bufferDuration.
     * @public
     * @chainable
     */
  }, {
    key: 'setDelay',
    value: function setDelay(delay) {
      var delayLeft = 1 / 1000 + delay / 2;
      var delayRight = 1 / 1000 - delay / 2;
      this.fractionalDelayLeft.setDelay(delayLeft);
      this.fractionalDelayRight.setDelay(delayRight);
    }
  }, {
    key: 'processorNodeFunction',
    value: function processorNodeFunction() {
      var that = this;
      this.processorNode.onaudioprocess = function (e) {
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
  }, {
    key: 'connect',
    value: function connect(node) {
      this.gainNode.connect(node);
      return this;
    }

    /**
     * Disconnect the convolverAudioGraph to a node
     * @public
     * @chainable
     * @param node Destination node
     */
  }, {
    key: 'disconnect',
    value: function disconnect(node) {
      this.gainNode.disconnect(node);
      return this;
    }
  }, {
    key: 'gain',
    get: function get() {
      return this.gainNode.gain;
    }
  }]);

  return ProcessingAudioGraph;
})();

module.exports = exports['default'];
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImVzNi9iaW5hdXJhbC1tb2RlbGVkLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7OzttQkFNZ0IsS0FBSzs7Ozs0QkFDSSxlQUFlOzs7OytCQUNaLGtCQUFrQjs7Ozs7Ozs7SUFNekIsZUFBZTs7Ozs7OztBQU12QixXQU5RLGVBQWUsQ0FNdEIsT0FBTyxFQUFFOzBCQU5GLGVBQWU7O0FBT2hDLFFBQUksQ0FBQyxZQUFZLEdBQUcsT0FBTyxDQUFDLFlBQVksQ0FBQzs7QUFFekMsUUFBSSxDQUFDLFdBQVcsR0FBRyxTQUFTLENBQUM7QUFDN0IsUUFBSSxDQUFDLGlCQUFpQixHQUFHLFNBQVMsQ0FBQztBQUNuQyxRQUFJLENBQUMsWUFBWSxHQUFHLEVBQUUsQ0FBQztBQUN2QixRQUFJLENBQUMsMkJBQTJCLEdBQUcsS0FBSyxDQUFDO0FBQ3pDLFFBQUksQ0FBQyxRQUFRLEdBQUcsRUFBRSxDQUFDO0FBQ25CLFFBQUksQ0FBQyxpQkFBaUIsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDO0FBQ25DLFFBQUksQ0FBQyxVQUFVLEdBQUcsSUFBSSxDQUFDO0FBQ3ZCLFFBQUksQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLENBQUM7O0FBRWYsUUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLFVBQVUsRUFBRSxDQUFDOzs7Ozs7O0FBTzVDLFFBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxvQkFBb0IsQ0FBQztBQUM3QyxrQkFBWSxFQUFFLElBQUksQ0FBQyxZQUFZO0tBQ2hDLENBQUMsQ0FBQztBQUNILFFBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLEtBQUssR0FBRyxDQUFDLENBQUM7QUFDbkMsUUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxLQUFLLENBQUMsQ0FBQzs7QUFFOUMsUUFBSSxDQUFDLG1CQUFtQixHQUFHLElBQUksb0JBQW9CLENBQUM7QUFDbEQsa0JBQVks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QUM7T0FDcEUsQ0FBQztLQUNIOzs7Ozs7Ozs7O1dBUU0saUJBQUMsSUFBSSxFQUFFO0FBQ1osVUFBSSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDNUIsYUFBTyxJQUFJLENBQUM7S0FDYjs7Ozs7Ozs7OztXQVFTLG9CQUFDLElBQUksRUFBRTtBQUNmLFVBQUksQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQy9CLGFBQU8sSUFBSSxDQUFDO0tBQ2I7OztTQWxFTyxlQUFHO0FBQ1QsYUFBTyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQztLQUMzQjs7O1NBdkJHLG9CQUFvQiIsImZpbGUiOiJlczYvYmluYXVyYWwtbW9kZWxlZC5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGZpbGVPdmVydmlld1xuICpcbiAqIEBhdXRob3IgQXJuYXUgSnVsacOgIDxBcm5hdS5KdWxpYUBnbWFpbC5jb20+XG4gKiBAdmVyc2lvbiAwLjEuMFxuICovXG5pbXBvcnQga2R0IGZyb20gJ2tkdCc7XG5pbXBvcnQgQmlxdWFkRmlsdGVyIGZyb20gJ2JpcXVhZC1maWx0ZXInO1xuaW1wb3J0IEZyYWN0aW9uYWxEZWxheSBmcm9tICdmcmFjdGlvbmFsLWRlbGF5JztcblxuXG4vKipcbiAqIEBjbGFzcyBCaW5hdXJhbE1vZGVsZWRcbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmluYXVyYWxNb2RlbGVkIHtcbiAgLyoqXG4gICAqIE1hbmRhdG9yeSBpbml0aWFsaXphdGlvbiBtZXRob2QuXG4gICAqIEBwdWJsaWNcbiAgICogQGNoYWluYWJsZVxuICAgKi9cbiAgY29uc3RydWN0b3Iob3B0aW9ucykge1xuICAgIHRoaXMuYXVkaW9Db250ZXh0ID0gb3B0aW9ucy5hdWRpb0NvbnRleHQ7XG4gICAgLy8gUHJpdmF0ZSBwcm9wZXJ0aWVzXG4gICAgdGhpcy5ocnRmRGF0YXNldCA9IHVuZGVmaW5lZDtcbiAgICB0aGlzLmhydGZEYXRhc2V0TGVuZ3RoID0gdW5kZWZpbmVkO1xuICAgIHRoaXMubmV4dFBvc2l0aW9uID0gW107XG4gICAgdGhpcy5jaGFuZ2VXaGVuRmluaXNoQ3Jvc3NmYWRpbmcgPSBmYWxzZTtcbiAgICB0aGlzLnBvc2l0aW9uID0gW107XG4gICAgdGhpcy5jcm9zc2ZhZGVEdXJhdGlvbiA9IDIwIC8gMTAwMDtcbiAgICB0aGlzLmJ1ZmZlclNpemUgPSAxMDI0O1xuICAgIHRoaXMudHJlZSA9IC0xO1xuXG4gICAgdGhpcy5pbnB1dCA9IHRoaXMuYXVkaW9Db250ZXh0LmNyZWF0ZUdhaW4oKTtcblxuICAgIC8vIFR3byBzdWIgYXVkaW8gZ3JhcGhzIGNyZWF0aW9uOlxuICAgIC8vIC0gbWFpbkNvbnZvbHZlciB3aGljaCByZXByZXNlbnRzIHRoZSBjdXJyZW50IHN0YXRlXG4gICAgLy8gLSBhbmQgc2Vjb25kYXJ5Q29udm9sdmVyIHdoaWNoIHJlcHJlc2VudHMgdGhlIHBvdGVudGlhbCB0YXJnZXQgc3RhdGVcbiAgICAvLyAgIHdoZW4gbW92aW5nIHNvdW5kIHRvIGEgbmV3IHBvc2l0aW9uXG5cbiAgICB0aGlzLm1haW5BdWRpb0dyYXBoID0gbmV3IFByb2Nlc3NpbmdBdWRpb0dyYXBoKHtcbiAgICAgIGF1ZGlvQ29udGV4dDogdGhpcy5hdWRpb0NvbnRleHRcbiAgICB9KTtcbiAgICB0aGlzLm1haW5BdWRpb0dyYXBoLmdhaW4udmFsdWUgPSAxO1xuICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLm1haW5BdWRpb0dyYXBoLmlucHV0KTtcblxuICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaCA9IG5ldyBQcm9jZXNzaW5nQXVkaW9HcmFwaCh7XG4gICAgICBhdWRpb0NvbnRleHQ6IHRoaXMuYXVkaW9Db250ZXh0XG4gICAgfSk7XG4gICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLmdhaW4udmFsdWUgPSAwO1xuICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguaW5wdXQpO1xuICAgIC8vIFdlYiBBdWRpb1xuICAgIHRoaXMuc2FtcGxlUmF0ZSA9IHRoaXMuYXVkaW9Db250ZXh0LnNhbXBsZVJhdGU7XG4gICAgLy9Db25uZWN0aW9uc1xuICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLm1haW5BdWRpb0dyYXBoLmlucHV0KTtcbiAgICB0aGlzLmlucHV0LmNvbm5lY3QodGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLmlucHV0KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25uZWN0cyB0aGUgYmluYXVyYWxNb2RlbGVkTm9kZSB0byB0aGUgV2ViIEF1ZGlvIGdyYXBoXG4gICAqIEBwdWJsaWNcbiAgICogQGNoYWluYWJsZVxuICAgKiBAcGFyYW0gbm9kZSBEZXN0aW5hdGlvbiBub2RlXG4gICAqL1xuICBjb25uZWN0KG5vZGUpIHtcbiAgICB0aGlzLm1haW5BdWRpb0dyYXBoLmNvbm5lY3Qobm9kZSk7XG4gICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLmNvbm5lY3Qobm9kZSk7XG4gICAgcmV0dXJuIHRoaXM7IC8vIEZvciBjaGFpbmFiaWxpdHlcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNjb25uZWN0IHRoZSBiaW5hdXJhbE1vZGVsZWROb2RlIGZyb20gdGhlIFdlYiBBdWRpbyBncmFwaFxuICAgKiBAcHVibGljXG4gICAqIEBjaGFpbmFibGVcbiAgICogQHBhcmFtIG5vZGUgRGVzdGluYXRpb24gbm9kZVxuICAgKi9cbiAgZGlzY29ubmVjdChub2RlKSB7XG4gICAgdGhpcy5tYWluQXVkaW9HcmFwaC5kaXNjb25uZWN0KG5vZGUpO1xuICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5kaXNjb25uZWN0KG5vZGUpO1xuICAgIHJldHVybiB0aGlzOyAvLyBGb3IgY2hhaW5hYmlsaXR5XG4gIH1cblxuICAvKipcbiAgICogU2V0IEhSVEYgRGF0YXNldCB0byBiZSB1c2VkIHdpdGggdGhlIHZpcnR1YWwgc291cmNlLlxuICAgKiBAcHVibGljXG4gICAqIEBjaGFpbmFibGVcbiAgICogQHBhcmFtIGhydGZEYXRhc2V0IEFycmF5IG9mIE9iamVjdHMgY29udGFpbmluZyB0aGUgYXppbXV0aCwgZGlzdGFuY2UsIGVsZXZhdGlvbiwgdXJsIGFuZCBidWZmZXIgZm9yIGVhY2ggcG9pbnRcbiAgICovXG4gIHNldCBIUlRGRGF0YXNldChocnRmRGF0YXNldCkge1xuICAgIHRoaXMuaHJ0ZkRhdGFzZXQgPSBocnRmRGF0YXNldDtcbiAgICB0aGlzLmhydGZEYXRhc2V0TGVuZ3RoID0gdGhpcy5ocnRmRGF0YXNldC5sZW5ndGg7XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuaHJ0ZkRhdGFzZXRMZW5ndGg7IGkrKykge1xuICAgICAgdmFyIGhydGYgPSB0aGlzLmhydGZEYXRhc2V0W2ldO1xuICAgICAgLy8gQXppbXV0aCBhbmQgZWxldmF0aW9uIHRvIHJhZGlhbnNcbiAgICAgIHZhciBhemltdXRoUmFkaWFucyA9IGhydGYuYXppbXV0aCAqIE1hdGguUEkgLyAxODA7XG4gICAgICB2YXIgZWxldmF0aW9uUmFkaWFucyA9IGhydGYuZWxldmF0aW9uICogTWF0aC5QSSAvIDE4MDtcbiAgICAgIHZhciBjYXRlc2lhbkNvb3JkID0gdGhpcy5zcGhlcmljYWxUb0NhcnRlc2lhbihhemltdXRoUmFkaWFucywgZWxldmF0aW9uUmFkaWFucywgaHJ0Zi5kaXN0YW5jZSk7XG4gICAgICBocnRmLnggPSBjYXRlc2lhbkNvb3JkLng7XG4gICAgICBocnRmLnkgPSBjYXRlc2lhbkNvb3JkLnk7XG4gICAgICBocnRmLnogPSBjYXRlc2lhbkNvb3JkLno7XG4gICAgfVxuICAgIHRoaXMudHJlZSA9IGtkdC5jcmVhdGVLZFRyZWUodGhpcy5ocnRmRGF0YXNldCwgdGhpcy5kaXN0YW5jZSwgWyd4JywgJ3knLCAneiddKTtcblxuICAgIC8vIFB1dCBkZWZhdWx0IHZhbHVlc1xuICAgIHZhciBocnRmTmV4dFBvc2l0aW9uID0gdGhpcy5nZXRIUlRGKDAsIDAsIDEpO1xuICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5zZXRDb2VmZmljaWVudHMoaHJ0Zk5leHRQb3NpdGlvbi5paXJfY29lZmZzX2xlZnQsIGhydGZOZXh0UG9zaXRpb24uaWlyX2NvZWZmc19yaWdodCk7XG4gICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLnNldERlbGF5KGhydGZOZXh0UG9zaXRpb24uaXRkIC8gMTAwMCk7XG4gICAgdGhpcy5tYWluQXVkaW9HcmFwaC5zZXRDb2VmZmljaWVudHMoaHJ0Zk5leHRQb3NpdGlvbi5paXJfY29lZmZzX2xlZnQsIGhydGZOZXh0UG9zaXRpb24uaWlyX2NvZWZmc19yaWdodCk7XG4gICAgdGhpcy5tYWluQXVkaW9HcmFwaC5zZXREZWxheShocnRmTmV4dFBvc2l0aW9uLml0ZCAvIDEwMDApO1xuICB9XG4gIGdldCBIUlRGRGF0YXNldCgpIHtcbiAgICByZXR1cm4gdGhpcy5ocnRmRGF0YXNldDtcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxjdWxhdGUgdGhlIGRpc3RhbmNlIGJldHdlZW4gdHdvIHBvaW50cyBpbiBhIDMtRCBzcGFjZS5cbiAgICogQHByaXZhdGVcbiAgICogQGNoYWluYWJsZVxuICAgKiBAcGFyYW0gYSBPYmplY3QgY29udGFpbmluZyB0aHJlZSBwcm9wZXJ0aWVzOiB4LCB5LCB6XG4gICAqIEBwYXJhbSBiIE9iamVjdCBjb250YWluaW5nIHRocmVlIHByb3BlcnRpZXM6IHgsIHksIHpcbiAgICovXG4gIGRpc3RhbmNlKGEsIGIpIHtcbiAgICAvLyBObyBuZWVkIHRvIGNvbXB1dGUgc3F1YXJlIHJvb3QgaGVyZSBmb3IgZGlzdGFuY2UgY29tcGFyaXNvbiwgdGhpcyBpcyBtb3JlIGVmaWNpZW50LlxuICAgIHJldHVybiBNYXRoLnBvdyhhLnggLSBiLngsIDIpICsgTWF0aC5wb3coYS55IC0gYi55LCAyKSArIE1hdGgucG93KGEueiAtIGIueiwgMik7XG4gIH1cblxuICAvKipcbiAgICogU2V0IGdhaW4gdmFsdWUgYW5kIHNxdWFyZWQgdm9sdW1lLlxuICAgKiBAcHJpdmF0ZVxuICAgKiBAY2hhaW5hYmxlXG4gICAqIEB0b2RvIDogcmVhbG1lbnQgdmEgYXF1w60gYWl4w7I/XG4gICAqL1xuICBzZXRMYXN0UG9zaXRpb24oKSB7XG4gICAgaWYgKCF0aGlzLmlzQ3Jvc3NmYWRpbmcoKSkge1xuICAgICAgdGhpcy5jaGFuZ2VXaGVuRmluaXNoQ3Jvc3NmYWRpbmcgPSBmYWxzZTtcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5pbnRlcnZhbElEKTtcbiAgICAgIHRoaXMucmVhbGx5U3RhcnRQb3NpdGlvbigpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDcm9zc2ZhZGluZ1xuICAgKiBAcHJpdmF0ZVxuICAgKiBAY2hhaW5hYmxlXG4gICAqL1xuICBjcm9zc2ZhZGluZygpIHtcbiAgICAvLyBEbyB0aGUgY3Jvc3NmYWRpbmcgYmV0d2VlbiBtYWluQXVkaW9HcmFwaCBhbmQgc2Vjb25kYXJ5QXVkaW9HcmFwaFxuICAgIHZhciBub3cgPSB0aGlzLmF1ZGlvQ29udGV4dC5jdXJyZW50VGltZTtcbiAgICAvLyBXYWl0IHR3byBidWZmZXJzIHVudGlsIGRvIHRoZSBjaGFuZ2UgKHNjcmlwdFByb2Nlc3Nvck5vZGUgb25seSB1cGRhdGUgdGhlIHZhcmlhYmxlcyBhdCB0aGUgZmlyc3Qgc2FtcGxlIG9mIHRoZSBidWZmZXIpXG4gICAgdGhpcy5tYWluQXVkaW9HcmFwaC5nYWluLnNldFZhbHVlQXRUaW1lKDEsIG5vdyArIDIgKiB0aGlzLmJ1ZmZlclNpemUgLyB0aGlzLnNhbXBsZVJhdGUpO1xuICAgIHRoaXMubWFpbkF1ZGlvR3JhcGguZ2Fpbi5saW5lYXJSYW1wVG9WYWx1ZUF0VGltZSgwLCBub3cgKyB0aGlzLmNyb3NzZmFkZUR1cmF0aW9uICsgMiAqIHRoaXMuYnVmZmVyU2l6ZSAvIHRoaXMuc2FtcGxlUmF0ZSk7XG5cbiAgICB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguZ2Fpbi5zZXRWYWx1ZUF0VGltZSgwLCBub3cgKyAyICogdGhpcy5idWZmZXJTaXplIC8gdGhpcy5zYW1wbGVSYXRlKTtcbiAgICB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguZ2Fpbi5saW5lYXJSYW1wVG9WYWx1ZUF0VGltZSgxLCBub3cgKyB0aGlzLmNyb3NzZmFkZUR1cmF0aW9uICsgMiAqIHRoaXMuYnVmZmVyU2l6ZSAvIHRoaXMuc2FtcGxlUmF0ZSk7XG4gIH1cblxuICAvKipcbiAgICogU2V0IHBvc2l0aW9uIG9mIHRoZSB2aXJ0dWFsIHNvdXJjZVxuICAgKiBAcHVibGljXG4gICAqIEBjaGFpbmFibGVcbiAgICogQHBhcmFtIGF6aW11dGggQXppbXV0aCBpbiBkZWdyZWVzICjCsCk6IGZyb20gMCB0byAtMTgwIGZvciBzb3VyY2Ugb24geW91ciBsZWZ0LCBhbmQgZnJvbSAwIHRvIDE4MCBmb3Igc291cmNlIG9uIHlvdXIgcmlnaHRcbiAgICogQHBhcmFtIGVsZXZhdGlvbiBFbGV2YXRpb24gaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gOTAgZm9yIHNvdXJjZSBhYm92ZSB5b3VyIGhlYWQsIDAgZm9yIHNvdXJjZSBpbiBmcm9udCBvZiB5b3VyIGhlYWQsIGFuZCBmcm9tIDAgdG8gLTkwIGZvciBzb3VyY2UgYmVsb3cgeW91ciBoZWFkKVxuICAgKiBAcGFyYW0gZGlzdGFuY2UgRGlzdGFuY2UgaW4gbWV0ZXJzXG4gICAqL1xuICBzZXRQb3NpdGlvbihhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKSB7XG5cbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMykge1xuICAgICAgLy8gQ2FsY3VsYXRlIHRoZSBuZWFyZXN0IHBvc2l0aW9uIGZvciB0aGUgaW5wdXQgYXppbXV0aCwgZWxldmF0aW9uIGFuZCBkaXN0YW5jZVxuICAgICAgdmFyIG5lYXJlc3RQb3NpdGlvbiA9IHRoaXMuZ2V0UmVhbENvb3JkaW5hdGVzKGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpO1xuICAgICAgLy8gTm8gbmVlZCB0byBjaGFuZ2UgdGhlIGN1cnJlbnQgSFJURiBsb2FkZWQgaWYgc2V0dGVkIHBvc2l0aW9uIGVxdWFsIGN1cnJlbnQgcG9zaXRpb25cbiAgICAgIGlmIChuZWFyZXN0UG9zaXRpb24uYXppbXV0aCAhPT0gdGhpcy5wb3NpdGlvbi5hemltdXRoIHx8IG5lYXJlc3RQb3NpdGlvbi5lbGV2YXRpb24gIT09IHRoaXMucG9zaXRpb24uZWxldmF0aW9uIHx8IG5lYXJlc3RQb3NpdGlvbi5kaXN0YW5jZSAhPT0gdGhpcy5wb3NpdGlvbi5kaXN0YW5jZSkge1xuICAgICAgICAvLyBDaGVjayBpZiB0aGUgY3Jvc3NmYWRpbmcgaXMgYWN0aXZlXG4gICAgICAgIGlmICh0aGlzLmlzQ3Jvc3NmYWRpbmcoKSA9PT0gdHJ1ZSkge1xuICAgICAgICAgIC8vIENoZWNrIGlmIHRoZXJlIGlzIGEgdmFsdWUgd2FpdGluZyB0byBiZSBzZXRcbiAgICAgICAgICBpZiAodGhpcy5jaGFuZ2VXaGVuRmluaXNoQ3Jvc3NmYWRpbmcgPT09IHRydWUpIHtcbiAgICAgICAgICAgIC8vIFN0b3AgdGhlIHBhc3Qgc2V0SW50ZXJ2YWwgZXZlbnQuXG4gICAgICAgICAgICBjbGVhckludGVydmFsKHRoaXMuaW50ZXJ2YWxJRCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuY2hhbmdlV2hlbkZpbmlzaENyb3NzZmFkaW5nID0gdHJ1ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBTYXZlIHRoZSBwb3NpdGlvblxuICAgICAgICAgIHRoaXMubmV4dFBvc2l0aW9uLmF6aW11dGggPSBuZWFyZXN0UG9zaXRpb24uYXppbXV0aDtcbiAgICAgICAgICB0aGlzLm5leHRQb3NpdGlvbi5lbGV2YXRpb24gPSBuZWFyZXN0UG9zaXRpb24uZWxldmF0aW9uO1xuICAgICAgICAgIHRoaXMubmV4dFBvc2l0aW9uLmRpc3RhbmNlID0gbmVhcmVzdFBvc2l0aW9uLmRpc3RhbmNlO1xuXG4gICAgICAgICAgLy8gU3RhcnQgdGhlIHNldEludGVydmFsOiB3YWl0IHVudGlsIHRoZSBjcm9zc2ZhZGluZyBpcyBmaW5pc2hlZC5cbiAgICAgICAgICB0aGlzLmludGVydmFsSUQgPSB3aW5kb3cuc2V0SW50ZXJ2YWwodGhpcy5zZXRMYXN0UG9zaXRpb24uYmluZCh0aGlzKSwgMC4wMDUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMubmV4dFBvc2l0aW9uLmF6aW11dGggPSBuZWFyZXN0UG9zaXRpb24uYXppbXV0aDtcbiAgICAgICAgICB0aGlzLm5leHRQb3NpdGlvbi5lbGV2YXRpb24gPSBuZWFyZXN0UG9zaXRpb24uZWxldmF0aW9uO1xuICAgICAgICAgIHRoaXMubmV4dFBvc2l0aW9uLmRpc3RhbmNlID0gbmVhcmVzdFBvc2l0aW9uLmRpc3RhbmNlO1xuICAgICAgICAgIHRoaXMucmVhbGx5U3RhcnRQb3NpdGlvbigpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzOyAvLyBGb3IgY2hhaW5hYmlsaXR5XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWxseSBjaGFuZ2UgdGhlIHBvc2l0aW9uXG4gICAqIEBwcml2YXRlXG4gICAqL1xuICByZWFsbHlTdGFydFBvc2l0aW9uKCkge1xuICAgIC8vIFNhdmUgdGhlIGN1cnJlbnQgcG9zaXRpb25cbiAgICB0aGlzLnBvc2l0aW9uLmF6aW11dGggPSB0aGlzLm5leHRQb3NpdGlvbi5hemltdXRoO1xuICAgIHRoaXMucG9zaXRpb24uZWxldmF0aW9uID0gdGhpcy5uZXh0UG9zaXRpb24uZWxldmF0aW9uO1xuICAgIHRoaXMucG9zaXRpb24uZGlzdGFuY2UgPSB0aGlzLm5leHRQb3NpdGlvbi5kaXN0YW5jZTtcblxuICAgIHZhciBocnRmTmV4dFBvc2l0aW9uID0gdGhpcy5nZXRIUlRGKHRoaXMucG9zaXRpb24uYXppbXV0aCwgdGhpcy5wb3NpdGlvbi5lbGV2YXRpb24sIHRoaXMucG9zaXRpb24uZGlzdGFuY2UpO1xuICAgIC8vIExvYWQgdGhlIG5ldyBwb3NpdGlvbiBpbiB0aGUgYmlxdWFkIGFuZCBkZWxheSBub3QgYWN0aXZlIChzZWNvbmRhcnlBdWRpb0dyYXBoKVxuICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5zZXRDb2VmZmljaWVudHMoaHJ0Zk5leHRQb3NpdGlvbi5paXJfY29lZmZzX2xlZnQsIGhydGZOZXh0UG9zaXRpb24uaWlyX2NvZWZmc19yaWdodCk7XG4gICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLnNldERlbGF5KGhydGZOZXh0UG9zaXRpb24uaXRkIC8gMTAwMCk7XG5cbiAgICAvLyBEbyB0aGUgY3Jvc3NmYWRpbmcgYmV0d2VlbiBtYWluQXVkaW9HcmFwaCBhbmQgc2Vjb25kYXJ5QXVkaW9HcmFwaFxuICAgIHRoaXMuY3Jvc3NmYWRpbmcoKTtcblxuICAgIC8vIENoYW5nZSBjdXJyZW50IG1haW5BdWRpb0dyYXBoXG4gICAgdmFyIGFjdGl2ZSA9IHRoaXMubWFpbkF1ZGlvR3JhcGg7XG4gICAgdGhpcy5tYWluQXVkaW9HcmFwaCA9IHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaDtcbiAgICB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGggPSBhY3RpdmU7XG4gIH1cblxuICAvKipcbiAgICogR2V0IHRoZSBjdXJyZW50IHBvc2l0aW9uIG9mIHRoZSB2aXJ0dWFsIHNvdXJjZS5cbiAgICogQHB1YmxpY1xuICAgKi9cbiAgZ2V0UG9zaXRpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMucG9zaXRpb247XG4gIH1cblxuICAvKipcbiAgICogUGF1c2UgcGxheWluZy5cbiAgICogQHB1YmxpY1xuICAgKi9cbiAgc2V0Q3Jvc3NmYWRlRHVyYXRpb24obXNSYW1wKSB7XG4gICAgLy9zYXZlIGluIHNlY29uZHNcbiAgICB0aGlzLmNyb3NzZmFkZUR1cmF0aW9uID0gbXNSYW1wIC8gMTAwMDtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZWVrIGJ1ZmZlciBwb3NpdGlvbiAoaW4gc2VjKS5cbiAgICogQHB1YmxpY1xuICAgKi9cbiAgZ2V0Q3Jvc3NmYWRlRHVyYXRpb24oKSB7XG4gICAgLy9yZXR1cm4gaW4gbXNcbiAgICByZXR1cm4gdGhpcy5jcm9zc2ZhZGVEdXJhdGlvbiAqIDEwMDA7XG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZSBwbGF5aW5nIGZsYWcgd2hlbiB0aGUgZW5kIG9mIHRoZSBidWZmZXIgaXMgcmVhY2hlZC5cbiAgICogQHB1YmxpY1xuICAgKiBAdG9kbyBIYW5kbGUgc3BlZWQgY2hhbmdlcy5cbiAgICovXG4gIGlzQ3Jvc3NmYWRpbmcoKSB7XG4gICAgLy8gVGhlIHJhbXBzIGFyZSBub3QgZmluaXNoZWQsIHNvIHRoZSBjcm9zc2ZhZGluZyBpcyBub3QgZmluaXNoZWRcbiAgICBpZiAodGhpcy5tYWluQXVkaW9HcmFwaC5nYWluLnZhbHVlICE9PSAxKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIEhSVEYgZmlsZSBmb3IgYW4gZXNwZWNpZmljIHBvc2l0aW9uXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSBhemltdXRoIEF6aW11dGggaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gLTE4MCBmb3Igc291cmNlIG9uIHlvdXIgbGVmdCwgYW5kIGZyb20gMCB0byAxODAgZm9yIHNvdXJjZSBvbiB5b3VyIHJpZ2h0XG4gICAqIEBwYXJhbSBlbGV2YXRpb24gRWxldmF0aW9uIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIDkwIGZvciBzb3VyY2UgYWJvdmUgeW91ciBoZWFkLCAwIGZvciBzb3VyY2UgaW4gZnJvbnQgb2YgeW91ciBoZWFkLCBhbmQgZnJvbSAwIHRvIC05MCBmb3Igc291cmNlIGJlbG93IHlvdXIgaGVhZClcbiAgICogQHBhcmFtIGRpc3RhbmNlIERpc3RhbmNlIGluIG1ldGVyc1xuICAgKi9cbiAgZ2V0SFJURihhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKSB7XG4gICAgdmFyIG5lYXJlc3QgPSB0aGlzLmdldE5lYXJlc3RQb2ludChhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKTtcbiAgICB2YXIgaHJ0ZiA9IFtdO1xuICAgIGhydGYuaWlyX2NvZWZmc19sZWZ0ID0gbmVhcmVzdC5paXJfY29lZmZzX2xlZnQ7XG4gICAgaHJ0Zi5paXJfY29lZmZzX3JpZ2h0ID0gbmVhcmVzdC5paXJfY29lZmZzX3JpZ2h0O1xuICAgIGhydGYuaXRkID0gbmVhcmVzdC5pdGQ7XG5cbiAgICAvLyBSZXR1cm4gaHJ0ZiBkYXRhIG9mIG5lYXJlc3QgcG9zaXRpb24gZm9yIHRoZSBpbnB1dCB2YWx1ZXNcbiAgICByZXR1cm4gaHJ0ZjtcbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFuc2Zvcm0gdGhlIHNwaGVyaWNhbCB0byBjYXJ0ZXNpYW4gY29vcmRpbmF0ZXMuXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSBhemltdXRoIEF6aW11dGggaW4gcmFkaWFuc1xuICAgKiBAcGFyYW0gZWxldmF0aW9uIEVsZXZhdGlvbiBpbiByYWRpYW5zXG4gICAqIEBwYXJhbSBkaXN0YW5jZSBEaXN0YW5jZSBpbiBtZXRlcnNcbiAgICovXG4gIHNwaGVyaWNhbFRvQ2FydGVzaWFuKGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpIHtcbiAgICByZXR1cm4ge1xuICAgICAgeDogZGlzdGFuY2UgKiBNYXRoLnNpbihhemltdXRoKSxcbiAgICAgIHk6IGRpc3RhbmNlICogTWF0aC5jb3MoYXppbXV0aCksXG4gICAgICB6OiBkaXN0YW5jZSAqIE1hdGguc2luKGVsZXZhdGlvbilcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgbmVhcmVzdCBwb3NpdGlvbiBmb3IgYW4gaW5wdXQgcG9zaXRpb24uXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSBhemltdXRoIEF6aW11dGggaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gLTE4MCBmb3Igc291cmNlIG9uIHlvdXIgbGVmdCwgYW5kIGZyb20gMCB0byAxODAgZm9yIHNvdXJjZSBvbiB5b3VyIHJpZ2h0XG4gICAqIEBwYXJhbSBlbGV2YXRpb24gRWxldmF0aW9uIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIDkwIGZvciBzb3VyY2UgYWJvdmUgeW91ciBoZWFkLCAwIGZvciBzb3VyY2UgaW4gZnJvbnQgb2YgeW91ciBoZWFkLCBhbmQgZnJvbSAwIHRvIC05MCBmb3Igc291cmNlIGJlbG93IHlvdXIgaGVhZClcbiAgICogQHBhcmFtIGRpc3RhbmNlIERpc3RhbmNlIGluIG1ldGVyc1xuICAgKi9cbiAgZ2V0UmVhbENvb3JkaW5hdGVzKGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpIHtcbiAgICB2YXIgbmVhcmVzdCA9IHRoaXMuZ2V0TmVhcmVzdFBvaW50KGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpO1xuICAgIC8vIFJldHVybiBhemltdXRoLCBlbGV2YXRpb24gYW5kIGRpc3RhbmNlIG9mIG5lYXJlc3QgcG9zaXRpb24gZm9yIHRoZSBpbnB1dCB2YWx1ZXNcbiAgICByZXR1cm4ge1xuICAgICAgYXppbXV0aDogbmVhcmVzdC5hemltdXRoLFxuICAgICAgZWxldmF0aW9uOiBuZWFyZXN0LmVsZXZhdGlvbixcbiAgICAgIGRpc3RhbmNlOiBuZWFyZXN0LmRpc3RhbmNlXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIG5lYXJlc3QgcG9zaXRpb24gZm9yIGFuIGlucHV0IHBvc2l0aW9uLlxuICAgKiBAcHJpdmF0ZVxuICAgKiBAcGFyYW0gYXppbXV0aCBBemltdXRoIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIC0xODAgZm9yIHNvdXJjZSBvbiB5b3VyIGxlZnQsIGFuZCBmcm9tIDAgdG8gMTgwIGZvciBzb3VyY2Ugb24geW91ciByaWdodFxuICAgKiBAcGFyYW0gZWxldmF0aW9uIEVsZXZhdGlvbiBpbiBkZWdyZWVzICjCsCk6IGZyb20gMCB0byA5MCBmb3Igc291cmNlIGFib3ZlIHlvdXIgaGVhZCwgMCBmb3Igc291cmNlIGluIGZyb250IG9mIHlvdXIgaGVhZCwgYW5kIGZyb20gMCB0byAtOTAgZm9yIHNvdXJjZSBiZWxvdyB5b3VyIGhlYWQpXG4gICAqIEBwYXJhbSBkaXN0YW5jZSBEaXN0YW5jZSBpbiBtZXRlcnNcbiAgICovXG4gIGdldE5lYXJlc3RQb2ludChhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKSB7XG4gICAgLy8gRGVncmVlcyB0byByYWRpYW5zIGZvciB0aGUgYXppbXV0aCBhbmQgZWxldmF0aW9uXG4gICAgdmFyIGF6aW11dGhSYWRpYW5zID0gYXppbXV0aCAqIE1hdGguUEkgLyAxODA7XG4gICAgdmFyIGVsZXZhdGlvblJhZGlhbnMgPSBlbGV2YXRpb24gKiBNYXRoLlBJIC8gMTgwO1xuICAgIC8vIENvbnZlcnQgc3BoZXJpY2FsIGNvb3JkaW5hdGVzIHRvIGNhcnRlc2lhblxuICAgIHZhciBjYXJ0ZXNpYW5Db29yZCA9IHRoaXMuc3BoZXJpY2FsVG9DYXJ0ZXNpYW4oYXppbXV0aFJhZGlhbnMsIGVsZXZhdGlvblJhZGlhbnMsIGRpc3RhbmNlKTtcbiAgICAvLyBHZXQgdGhlIG5lYXJlc3QgSFJURiBmaWxlIGZvciB0aGUgZGVzaXJlZCBwb3NpdGlvblxuICAgIHZhciBuZWFyZXN0ID0gdGhpcy50cmVlLm5lYXJlc3QoY2FydGVzaWFuQ29vcmQsIDEpWzBdO1xuXG4gICAgcmV0dXJuIG5lYXJlc3RbMF07XG4gIH1cbn1cblxuXG4vKipcbiAqIEF1ZGlvR3JhcGggc3ViIGF1ZGlvIGdyYXBoIG9iamVjdCBhcyBhbiBFQ01BU2NyaXB0NSBwcm9wZXJ0aWVzIG9iamVjdC5cbiAqL1xuY2xhc3MgUHJvY2Vzc2luZ0F1ZGlvR3JhcGgge1xuICBjb25zdHJ1Y3RvcihvcHRpb25zKSB7XG4gICAgdGhpcy5hdWRpb0NvbnRleHQgPSBvcHRpb25zLmF1ZGlvQ29udGV4dDtcbiAgICAvLyBQcml2YXRlIHByb3BlcnRpZXNcbiAgICB0aGlzLmJ1ZmZlclNpemUgPSAxMDI0O1xuXG4gICAgLy8gQ3JlYXRpb25zXG4gICAgdGhpcy5pbnB1dCA9IHRoaXMuYXVkaW9Db250ZXh0LmNyZWF0ZUdhaW4oKTtcbiAgICB0aGlzLmdhaW5Ob2RlID0gdGhpcy5hdWRpb0NvbnRleHQuY3JlYXRlR2FpbigpO1xuICAgIHRoaXMuYmlxdWFkRmlsdGVyTGVmdCA9IG5ldyBCaXF1YWRGaWx0ZXIoKTtcbiAgICB0aGlzLmJpcXVhZEZpbHRlclJpZ2h0ID0gbmV3IEJpcXVhZEZpbHRlcigpO1xuICAgIHRoaXMuZnJhY3Rpb25hbERlbGF5TGVmdCA9IG5ldyBGcmFjdGlvbmFsRGVsYXkoNDQxMDApO1xuICAgIHRoaXMuZnJhY3Rpb25hbERlbGF5UmlnaHQgPSBuZXcgRnJhY3Rpb25hbERlbGF5KDQ0MTAwKTtcbiAgICB0aGlzLnByb2Nlc3Nvck5vZGUgPSB0aGlzLmF1ZGlvQ29udGV4dC5jcmVhdGVTY3JpcHRQcm9jZXNzb3IodGhpcy5idWZmZXJTaXplKTtcbiAgICAvLyBDb25uZWN0aW9uc1xuICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLnByb2Nlc3Nvck5vZGUpO1xuICAgIHRoaXMucHJvY2Vzc29yTm9kZS5jb25uZWN0KHRoaXMuZ2Fpbk5vZGUpO1xuICAgIC8vIFN0YXJ0IHByb2Nlc3Nvck5vZGVcbiAgICB0aGlzLnByb2Nlc3Nvck5vZGVGdW5jdGlvbigpO1xuICB9XG5cbiAgZ2V0IGdhaW4oKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2Fpbk5vZGUuZ2FpbjtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXQgY29lZmZpY2llbnRzIGJpcXVhZCBmaWx0ZXJcbiAgICogQHB1YmxpY1xuICAgKiBAcGFyYW0gdmFsdWUgQXVkaW9CdWZmZXIgT2JqZWN0LlxuICAgKi9cbiAgc2V0Q29lZmZpY2llbnRzKGxlZnRDb2VmZmljaWVudHMsIHJpZ2h0Q29lZmZpY2llbnRzKSB7XG4gICAgdGhpcy5iaXF1YWRGaWx0ZXJMZWZ0LnNldENvZWZmaWNpZW50cyhsZWZ0Q29lZmZpY2llbnRzKTtcbiAgICB0aGlzLmJpcXVhZEZpbHRlclJpZ2h0LnNldENvZWZmaWNpZW50cyhyaWdodENvZWZmaWNpZW50cyk7XG4gIH1cblxuICAvKipcbiAgICogU2V0IGJ1ZmZlciBhbmQgYnVmZmVyRHVyYXRpb24uXG4gICAqIEBwdWJsaWNcbiAgICogQGNoYWluYWJsZVxuICAgKi9cbiAgc2V0RGVsYXkoZGVsYXkpIHtcbiAgICB2YXIgZGVsYXlMZWZ0ID0gMSAvIDEwMDAgKyBkZWxheSAvIDI7XG4gICAgdmFyIGRlbGF5UmlnaHQgPSAxIC8gMTAwMCAtIGRlbGF5IC8gMjtcbiAgICB0aGlzLmZyYWN0aW9uYWxEZWxheUxlZnQuc2V0RGVsYXkoZGVsYXlMZWZ0KTtcbiAgICB0aGlzLmZyYWN0aW9uYWxEZWxheVJpZ2h0LnNldERlbGF5KGRlbGF5UmlnaHQpO1xuICB9XG5cbiAgcHJvY2Vzc29yTm9kZUZ1bmN0aW9uKCkge1xuICAgIHZhciB0aGF0ID0gdGhpcztcbiAgICB0aGlzLnByb2Nlc3Nvck5vZGUub25hdWRpb3Byb2Nlc3MgPSBmdW5jdGlvbihlKSB7XG4gICAgICAvLyBHZXQgdGhlIGlucHV0QnVmZmVyXG4gICAgICB2YXIgaW5wdXRBcnJheSA9IGUuaW5wdXRCdWZmZXIuZ2V0Q2hhbm5lbERhdGEoMCk7XG5cbiAgICAgIC8vIEdldCB0aGUgb3V0cHV0QnVmZmVyc1xuICAgICAgdmFyIGxlZnRPdXRwdXRBcnJheSA9IGUub3V0cHV0QnVmZmVyLmdldENoYW5uZWxEYXRhKDApO1xuICAgICAgdmFyIHJpZ2h0T3V0cHV0QXJyYXkgPSBlLm91dHB1dEJ1ZmZlci5nZXRDaGFubmVsRGF0YSgxKTtcblxuICAgICAgLy8gRGVsYXlcbiAgICAgIHZhciBtZWRpdW1BcnJheUxlZnQgPSBuZXcgRmxvYXQzMkFycmF5KHRoYXQuZnJhY3Rpb25hbERlbGF5TGVmdC5wcm9jZXNzKGlucHV0QXJyYXkpKTtcbiAgICAgIHZhciBtZWRpdW1BcnJheVJpZ2h0ID0gbmV3IEZsb2F0MzJBcnJheSh0aGF0LmZyYWN0aW9uYWxEZWxheVJpZ2h0LnByb2Nlc3MoaW5wdXRBcnJheSkpO1xuXG4gICAgICAvLyBCaXF1YWRGaWx0ZXJcbiAgICAgIHRoYXQuYmlxdWFkRmlsdGVyTGVmdC5wcm9jZXNzKG1lZGl1bUFycmF5TGVmdCwgbGVmdE91dHB1dEFycmF5KTtcbiAgICAgIHRoYXQuYmlxdWFkRmlsdGVyUmlnaHQucHJvY2VzcyhtZWRpdW1BcnJheVJpZ2h0LCByaWdodE91dHB1dEFycmF5KTtcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIENvbm5lY3QgdGhlIGNvbnZvbHZlckF1ZGlvR3JhcGggdG8gYSBub2RlXG4gICAqIEBwdWJsaWNcbiAgICogQGNoYWluYWJsZVxuICAgKiBAcGFyYW0gbm9kZSBEZXN0aW5hdGlvbiBub2RlXG4gICAqL1xuICBjb25uZWN0KG5vZGUpIHtcbiAgICB0aGlzLmdhaW5Ob2RlLmNvbm5lY3Qobm9kZSk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogRGlzY29ubmVjdCB0aGUgY29udm9sdmVyQXVkaW9HcmFwaCB0byBhIG5vZGVcbiAgICogQHB1YmxpY1xuICAgKiBAY2hhaW5hYmxlXG4gICAqIEBwYXJhbSBub2RlIERlc3RpbmF0aW9uIG5vZGVcbiAgICovXG4gIGRpc2Nvbm5lY3Qobm9kZSkge1xuICAgIHRoaXMuZ2Fpbk5vZGUuZGlzY29ubmVjdChub2RlKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxufVxuIl19