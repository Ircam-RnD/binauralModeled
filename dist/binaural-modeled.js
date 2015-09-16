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
   * Constructor
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
   * AudioGraph sub audio graph object as an ECMAScript5 properties object.
   */

  /**
   * Connects the binauralModeledNode to the Web Audio graph
   * @public
   * @param node Destination node
   */

  _createClass(BinauralModeled, [{
    key: 'connect',
    value: function connect(node) {
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
  }, {
    key: 'disconnect',
    value: function disconnect(node) {
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
  }, {
    key: 'distance',

    /**
     * Calculate the distance between two points in a 3-D space.
     * @private
     * @param a Object containing three properties: x, y, z
     * @param b Object containing three properties: x, y, z
     */
    value: function distance(a, b) {
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
  }, {
    key: 'setPosition',
    value: function setPosition(azimuth, elevation, distance) {
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
  }, {
    key: '_crossfadeTo',
    value: function _crossfadeTo(target, position) {
      // Set the new target position
      this.position = position;
      this.target = target;
      var hrtf = this.getHRTF(this.position.azimuth, this.position.elevation, this.position.distance);
      var now = this.audioContext.currentTime;
      var next = now + this.crossfadeDuration;
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
      var intervalID = window.setInterval(endRamp, 10, this);
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
      this.convolverB.setCoefficients(hrtfNextPosition.iir_coeffs_left, hrtfNextPosition.iir_coeffs_right);
      this.convolverB.setDelay(hrtfNextPosition.itd / 1000);
      this.convolverA.setCoefficients(hrtfNextPosition.iir_coeffs_left, hrtfNextPosition.iir_coeffs_right);
      this.convolverA.setDelay(hrtfNextPosition.itd / 1000);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImVzNi9iaW5hdXJhbC1tb2RlbGVkLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7OzttQkFNZ0IsS0FBSzs7Ozs0QkFDSSxlQUFlOzs7OytCQUNaLGtCQUFrQjs7Ozs7Ozs7SUFNekIsZUFBZTs7Ozs7QUFJdkIsV0FKUSxlQUFlLENBSXRCLE9BQU8sRUFBRTswQkFKRixlQUFlOztBQUtoQyxRQUFJLENBQUMsWUFBWSxHQUFHLE9BQU8sQ0FBQyxZQUFZLENBQUM7O0FBRXpDLFFBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO0FBQzdCLFFBQUksQ0FBQyxpQkFBaUIsR0FBRyxTQUFTLENBQUM7QUFDbkMsUUFBSSxDQUFDLFlBQVksR0FBRyxFQUFFLENBQUM7QUFDdkIsUUFBSSxDQUFDLDJCQUEyQixHQUFHLEtBQUssQ0FBQztBQUN6QyxRQUFJLENBQUMsUUFBUSxHQUFHLEVBQUUsQ0FBQztBQUNuQixRQUFJLENBQUMsaUJBQWlCLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQztBQUNuQyxRQUFJLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQztBQUN2QixRQUFJLENBQUMsSUFBSSxHQUFHLENBQUMsQ0FBQyxDQUFDOztBQUVmLFFBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQyxVQUFVLEVBQUUsQ0FBQzs7QUFFNUMsUUFBSSxDQUFDLEtBQUssR0FBRyxHQUFHLENBQUM7QUFDakIsUUFBSSxDQUFDLE1BQU0sR0FBRyxTQUFTLENBQUM7QUFDeEIsUUFBSSxDQUFDLGVBQWUsR0FBRyxTQUFTLENBQUM7QUFDakMsUUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLG9CQUFvQixDQUFDO0FBQ3pDLGtCQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVk7S0FDaEMsQ0FBQyxDQUFDO0FBQ0gsUUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQztBQUMvQixRQUFJLENBQUMsS0FBSyxDQUFDLE9B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LEdBQUcsQ0FBQyxDQUFDLFlBQVksQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDdkQsWUFBSSxnQkFBZ0IsR0FBRyxDQUFDLENBQUMsWUFBWSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQzs7O0FBR3hELFlBQUksZUFBZSxHQUFHLElBQUksWUFBWSxDQUFDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQztBQUNyRixZQUFJLGdCQUFnQixHQUFHLElBQUksWUFBWSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQzs7O0FBR3ZGLFlBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsZUFBZSxFQUFFLGVBQWUsQ0FBQyxDQUFDO0FBQ2hFLFlBQUksQ0FBQyxpQkFBaUIsQ0FBQyxPQUFPLENBQUMsZ0JBQWdCLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztPQUNwRSxDQUFDO0tBQ0g7Ozs7Ozs7Ozs7V0FRTSxpQkFBQyxJQUFJLEVBQUU7QUFDWixVQUFJLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUM1QixhQUFPLElBQUksQ0FBQztLQUNiOzs7Ozs7Ozs7O1dBUVMsb0JBQUMsSUFBSSxFQUFFO0FBQ2YsVUFBSSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDL0IsYUFBTyxJQUFJLENBQUM7S0FDYjs7O1NBbEVPLGVBQUc7QUFDVCxhQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDO0tBQzNCOzs7U0F2Qkcsb0JBQW9CIiwiZmlsZSI6ImVzNi9iaW5hdXJhbC1tb2RlbGVkLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAZmlsZU92ZXJ2aWV3XG4gKlxuICogQGF1dGhvciBBcm5hdSBKdWxpw6AgPEFybmF1Lkp1bGlhQGdtYWlsLmNvbT5cbiAqIEB2ZXJzaW9uIDAuMS4wXG4gKi9cbmltcG9ydCBrZHQgZnJvbSAna2R0JztcbmltcG9ydCBCaXF1YWRGaWx0ZXIgZnJvbSAnYmlxdWFkLWZpbHRlcic7XG5pbXBvcnQgRnJhY3Rpb25hbERlbGF5IGZyb20gJ2ZyYWN0aW9uYWwtZGVsYXknO1xuXG5cbi8qKlxuICogQGNsYXNzIEJpbmF1cmFsTW9kZWxlZFxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCaW5hdXJhbE1vZGVsZWQge1xuICAvKipcbiAgICogQ29uc3RydWN0b3JcbiAgICovXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnMpIHtcbiAgICB0aGlzLmF1ZGlvQ29udGV4dCA9IG9wdGlvbnMuYXVkaW9Db250ZXh0O1xuICAgIC8vIFByaXZhdGUgcHJvcGVydGllc1xuICAgIHRoaXMuaHJ0ZkRhdGFzZXQgPSB1bmRlZmluZWQ7XG4gICAgdGhpcy5ocnRmRGF0YXNldExlbmd0aCA9IHVuZGVmaW5lZDtcbiAgICB0aGlzLm5leHRQb3NpdGlvbiA9IFtdO1xuICAgIHRoaXMuY2hhbmdlV2hlbkZpbmlzaENyb3NzZmFkaW5nID0gZmFsc2U7XG4gICAgdGhpcy5wb3NpdGlvbiA9IFtdO1xuICAgIHRoaXMuY3Jvc3NmYWRlRHVyYXRpb24gPSAyMCAvIDEwMDA7XG4gICAgdGhpcy5idWZmZXJTaXplID0gMTAyNDtcbiAgICB0aGlzLnRyZWUgPSAtMTtcblxuICAgIHRoaXMuaW5wdXQgPSB0aGlzLmF1ZGlvQ29udGV4dC5jcmVhdGVHYWluKCk7XG5cbiAgICB0aGlzLnN0YXRlID0gXCJBXCI7IC8vIFN0YXRlcyBpbiBbXCJBXCIsIFwiQlwiLCBcIkEyQlwiLCBcIkIyQVwiXVxuICAgIHRoaXMudGFyZ2V0ID0gdW5kZWZpbmVkO1xuICAgIHRoaXMucGVuZGluZ1Bvc2l0aW9uID0gdW5kZWZpbmVkO1xuICAgIHRoaXMuY29udm9sdmVyQSA9IG5ldyBQcm9jZXNzaW5nQXVkaW9HcmFwaCh7XG4gICAgICBhdWRpb0NvbnRleHQ6IHRoaXMuYXVkaW9Db250ZXh0XG4gICAgfSk7XG4gICAgdGhpcy5jb252b2x2ZXJBLmdhaW4udmFsdWUgPSAxO1xuICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLmNvbnZvbHZlckEuaW5wdXQpO1xuICAgIHRoaXMuY29udm9sdmVyQiA9IG5ldyBQcm9jZXNzaW5nQXVkaW9HcmFwaCh7XG4gICAgICBhdWRpb0NvbnRleHQ6IHRoaXMuYXVkaW9Db250ZXh0XG4gICAgfSk7XG4gICAgdGhpcy5jb252b2x2ZXJCLmdhaW4udmFsdWUgPSAwO1xuICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLmNvbnZvbHZlckIuaW5wdXQpO1xuICAgIHRoaXMuc2FtcGxlUmF0ZSA9IHRoaXMuYXVkaW9Db250ZXh0LnNhbXBsZVJhdGU7XG4gIH1cblxuICAvKipcbiAgICogQ29ubmVjdHMgdGhlIGJpbmF1cmFsTW9kZWxlZE5vZGUgdG8gdGhlIFdlYiBBdWRpbyBncmFwaFxuICAgKiBAcHVibGljXG4gICAqIEBwYXJhbSBub2RlIERlc3RpbmF0aW9uIG5vZGVcbiAgICovXG4gIGNvbm5lY3Qobm9kZSkge1xuICAgIC8vIHRoaXMubWFpbkF1ZGlvR3JhcGguY29ubmVjdChub2RlKTtcbiAgICAvLyB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguY29ubmVjdChub2RlKTtcbiAgICB0aGlzLmNvbnZvbHZlckEuY29ubmVjdChub2RlKTtcbiAgICB0aGlzLmNvbnZvbHZlckIuY29ubmVjdChub2RlKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNjb25uZWN0IHRoZSBiaW5hdXJhbE1vZGVsZWROb2RlIGZyb20gdGhlIFdlYiBBdWRpbyBncmFwaFxuICAgKiBAcHVibGljXG4gICAqIEBwYXJhbSBub2RlIERlc3RpbmF0aW9uIG5vZGVcbiAgICovXG4gIGRpc2Nvbm5lY3Qobm9kZSkge1xuICAgIC8vIHRoaXMubWFpbkF1ZGlvR3JhcGguZGlzY29ubmVjdChub2RlKTtcbiAgICAvLyB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguZGlzY29ubmVjdChub2RlKTtcbiAgICB0aGlzLmNvbnZvbHZlckEuZGlzY29ubmVjdChub2RlKTtcbiAgICB0aGlzLmNvbnZvbHZlckIuZGlzY29ubmVjdChub2RlKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXQgSFJURiBEYXRhc2V0IHRvIGJlIHVzZWQgd2l0aCB0aGUgdmlydHVhbCBzb3VyY2UuXG4gICAqIEBwdWJsaWNcbiAgICogQHBhcmFtIGhydGZEYXRhc2V0IEFycmF5IG9mIE9iamVjdHMgY29udGFpbmluZyB0aGUgYXppbXV0aCwgZGlzdGFuY2UsIGVsZXZhdGlvbiwgdXJsIGFuZCBidWZmZXIgZm9yIGVhY2ggcG9pbnRcbiAgICovXG4gIHNldCBIUlRGRGF0YXNldChocnRmRGF0YXNldCkge1xuICAgIHRoaXMuaHJ0ZkRhdGFzZXQgPSBocnRmRGF0YXNldDtcbiAgICB0aGlzLmhydGZEYXRhc2V0TGVuZ3RoID0gdGhpcy5ocnRmRGF0YXNldC5sZW5ndGg7XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuaHJ0ZkRhdGFzZXRMZW5ndGg7IGkrKykge1xuICAgICAgdmFyIGhydGYgPSB0aGlzLmhydGZEYXRhc2V0W2ldO1xuICAgICAgLy8gQXppbXV0aCBhbmQgZWxldmF0aW9uIHRvIHJhZGlhbnNcbiAgICAgIHZhciBhemltdXRoUmFkaWFucyA9IGhydGYuYXppbXV0aCAqIE1hdGguUEkgLyAxODA7XG4gICAgICB2YXIgZWxldmF0aW9uUmFkaWFucyA9IGhydGYuZWxldmF0aW9uICogTWF0aC5QSSAvIDE4MDtcbiAgICAgIHZhciBjYXRlc2lhbkNvb3JkID0gdGhpcy5zcGhlcmljYWxUb0NhcnRlc2lhbihhemltdXRoUmFkaWFucywgZWxldmF0aW9uUmFkaWFucywgaHJ0Zi5kaXN0YW5jZSk7XG4gICAgICBocnRmLnggPSBjYXRlc2lhbkNvb3JkLng7XG4gICAgICBocnRmLnkgPSBjYXRlc2lhbkNvb3JkLnk7XG4gICAgICBocnRmLnogPSBjYXRlc2lhbkNvb3JkLno7XG4gICAgfVxuICAgIHRoaXMudHJlZSA9IGtkdC5jcmVhdGVLZFRyZWUodGhpcy5ocnRmRGF0YXNldCwgdGhpcy5kaXN0YW5jZSwgWyd4JywgJ3knLCAneiddKTtcblxuICAgIC8vIFB1dCBkZWZhdWx0IHZhbHVlc1xuICAgIHZhciBocnRmTmV4dFBvc2l0aW9uID0gdGhpcy5nZXRIUlRGKDAsIDAsIDEpO1xuICAgIHRoaXMuY29udm9sdmVyQi5zZXRDb2VmZmljaWVudHMoaHJ0Zk5leHRQb3NpdGlvbi5paXJfY29lZmZzX2xlZnQsIGhydGZOZXh0UG9zaXRpb24uaWlyX2NvZWZmc19yaWdodCk7XG4gICAgdGhpcy5jb252b2x2ZXJCLnNldERlbGF5KGhydGZOZXh0UG9zaXRpb24uaXRkIC8gMTAwMCk7XG4gICAgdGhpcy5jb252b2x2ZXJBLnNldENvZWZmaWNpZW50cyhocnRmTmV4dFBvc2l0aW9uLmlpcl9jb2VmZnNfbGVmdCwgaHJ0Zk5leHRQb3NpdGlvbi5paXJfY29lZmZzX3JpZ2h0KTtcbiAgICB0aGlzLmNvbnZvbHZlckEuc2V0RGVsYXkoaHJ0Zk5leHRQb3NpdGlvbi5pdGQgLyAxMDAwKTtcbiAgfVxuICBnZXQgSFJURkRhdGFzZXQoKSB7XG4gICAgcmV0dXJuIHRoaXMuaHJ0ZkRhdGFzZXQ7XG4gIH1cblxuICAvKipcbiAgICogQ2FsY3VsYXRlIHRoZSBkaXN0YW5jZSBiZXR3ZWVuIHR3byBwb2ludHMgaW4gYSAzLUQgc3BhY2UuXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSBhIE9iamVjdCBjb250YWluaW5nIHRocmVlIHByb3BlcnRpZXM6IHgsIHksIHpcbiAgICogQHBhcmFtIGIgT2JqZWN0IGNvbnRhaW5pbmcgdGhyZWUgcHJvcGVydGllczogeCwgeSwgelxuICAgKi9cbiAgZGlzdGFuY2UoYSwgYikge1xuICAgIC8vIE5vIG5lZWQgdG8gY29tcHV0ZSBzcXVhcmUgcm9vdCBoZXJlIGZvciBkaXN0YW5jZSBjb21wYXJpc29uLCB0aGlzIGlzIG1vcmUgZWZpY2llbnQuXG4gICAgcmV0dXJuIE1hdGgucG93KGEueCAtIGIueCwgMikgKyBNYXRoLnBvdyhhLnkgLSBiLnksIDIpICsgTWF0aC5wb3coYS56IC0gYi56LCAyKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXQgcG9zaXRpb24gb2YgdGhlIHZpcnR1YWwgc291cmNlXG4gICAqIEBwdWJsaWNcbiAgICogQHBhcmFtIGF6aW11dGggQXppbXV0aCBpbiBkZWdyZWVzICjCsCk6IGZyb20gMCB0byAtMTgwIGZvciBzb3VyY2Ugb24geW91ciBsZWZ0LCBhbmQgZnJvbSAwIHRvIDE4MCBmb3Igc291cmNlIG9uIHlvdXIgcmlnaHRcbiAgICogQHBhcmFtIGVsZXZhdGlvbiBFbGV2YXRpb24gaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gOTAgZm9yIHNvdXJjZSBhYm92ZSB5b3VyIGhlYWQsIDAgZm9yIHNvdXJjZSBpbiBmcm9udCBvZiB5b3VyIGhlYWQsIGFuZCBmcm9tIDAgdG8gLTkwIGZvciBzb3VyY2UgYmVsb3cgeW91ciBoZWFkKVxuICAgKiBAcGFyYW0gZGlzdGFuY2UgRGlzdGFuY2UgaW4gbWV0ZXJzXG4gICAqL1xuICBzZXRQb3NpdGlvbihhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKSB7XG4gICAgLy8gQ2FsY3VsYXRlIHRoZSBuZWFyZXN0IHBvc2l0aW9uIGZvciB0aGUgaW5wdXQgYXppbXV0aCwgZWxldmF0aW9uIGFuZCBkaXN0YW5jZVxuICAgIHZhciBuZWFyZXN0UG9zaXRpb24gPSB0aGlzLmdldFJlYWxDb29yZGluYXRlcyhhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKTtcbiAgICBpZiAobmVhcmVzdFBvc2l0aW9uLmF6aW11dGggIT09IHRoaXMucG9zaXRpb24uYXppbXV0aCB8fCBuZWFyZXN0UG9zaXRpb24uZWxldmF0aW9uICE9PSB0aGlzLnBvc2l0aW9uLmVsZXZhdGlvbiB8fCBuZWFyZXN0UG9zaXRpb24uZGlzdGFuY2UgIT09IHRoaXMucG9zaXRpb24uZGlzdGFuY2UpIHtcbiAgICAgIHN3aXRjaCAodGhpcy5zdGF0ZSkge1xuICAgICAgICBjYXNlIFwiQVwiOlxuICAgICAgICAgIHRoaXMuc3RhdGUgPSBcIkEyQlwiO1xuICAgICAgICAgIHRoaXMucGVuZGluZ1Bvc2l0aW9uID0gdW5kZWZpbmVkO1xuICAgICAgICAgIHRoaXMuX2Nyb3NzZmFkZVRvKFwiQlwiLCBuZWFyZXN0UG9zaXRpb24pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwiQlwiOlxuICAgICAgICAgIHRoaXMuc3RhdGUgPSBcIkIyQVwiO1xuICAgICAgICAgIHRoaXMucGVuZGluZ1Bvc2l0aW9uID0gdW5kZWZpbmVkO1xuICAgICAgICAgIHRoaXMuX2Nyb3NzZmFkZVRvKFwiQVwiLCBuZWFyZXN0UG9zaXRpb24pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwiQTJCXCI6XG4gICAgICAgICAgdGhpcy5wZW5kaW5nUG9zaXRpb24gPSBuZWFyZXN0UG9zaXRpb247XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJCMkFcIjpcbiAgICAgICAgICB0aGlzLnBlbmRpbmdQb3NpdGlvbiA9IG5lYXJlc3RQb3NpdGlvbjtcbiAgICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBfY3Jvc3NmYWRlVG8odGFyZ2V0LCBwb3NpdGlvbikge1xuICAgIC8vIFNldCB0aGUgbmV3IHRhcmdldCBwb3NpdGlvblxuICAgIHRoaXMucG9zaXRpb24gPSBwb3NpdGlvbjtcbiAgICB0aGlzLnRhcmdldCA9IHRhcmdldDtcbiAgICBsZXQgaHJ0ZiA9IHRoaXMuZ2V0SFJURih0aGlzLnBvc2l0aW9uLmF6aW11dGgsIHRoaXMucG9zaXRpb24uZWxldmF0aW9uLCB0aGlzLnBvc2l0aW9uLmRpc3RhbmNlKTtcbiAgICBsZXQgbm93ID0gdGhpcy5hdWRpb0NvbnRleHQuY3VycmVudFRpbWU7XG4gICAgbGV0IG5leHQgPSBub3cgKyB0aGlzLmNyb3NzZmFkZUR1cmF0aW9uO1xuICAgIHN3aXRjaCAodGhpcy50YXJnZXQpIHtcbiAgICAgIGNhc2UgXCJBXCI6XG4gICAgICAgIHRoaXMuY29udm9sdmVyQS5zZXRDb2VmZmljaWVudHMoaHJ0Zi5paXJfY29lZmZzX2xlZnQsIGhydGYuaWlyX2NvZWZmc19yaWdodCk7XG4gICAgICAgIHRoaXMuY29udm9sdmVyQS5zZXREZWxheShocnRmLml0ZCAvIDEwMDApO1xuICAgICAgICB0aGlzLmNvbnZvbHZlckIuZ2Fpbi5saW5lYXJSYW1wVG9WYWx1ZUF0VGltZSgwLCBuZXh0KTtcbiAgICAgICAgdGhpcy5jb252b2x2ZXJBLmdhaW4ubGluZWFyUmFtcFRvVmFsdWVBdFRpbWUoMSwgbmV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBcIkJcIjpcbiAgICAgICAgdGhpcy5jb252b2x2ZXJCLnNldENvZWZmaWNpZW50cyhocnRmLmlpcl9jb2VmZnNfbGVmdCwgaHJ0Zi5paXJfY29lZmZzX3JpZ2h0KTtcbiAgICAgICAgdGhpcy5jb252b2x2ZXJCLnNldERlbGF5KGhydGYuaXRkIC8gMTAwMCk7XG4gICAgICAgIHRoaXMuY29udm9sdmVyQS5nYWluLmxpbmVhclJhbXBUb1ZhbHVlQXRUaW1lKDAsIG5leHQpO1xuICAgICAgICB0aGlzLmNvbnZvbHZlckIuZ2Fpbi5saW5lYXJSYW1wVG9WYWx1ZUF0VGltZSgxLCBuZXh0KTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICAgIC8vIFRyaWdnZXIgZXZlbnQgd2hlbiBsaW5lYXJSYW1wIGlzIHJlYWNoZWRcbiAgICBmdW5jdGlvbiBlbmRSYW1wKHRnKSB7XG4gICAgICBpZiAodGcuYXVkaW9Db250ZXh0LmN1cnJlbnRUaW1lID4gbmV4dCkge1xuICAgICAgICB3aW5kb3cuY2xlYXJJbnRlcnZhbChpbnRlcnZhbElEKTtcbiAgICAgICAgLy8gVGFyZ2V0IHN0YXRlIGlzIHJlYWNoZWRcbiAgICAgICAgdGcuc3RhdGUgPSB0Zy50YXJnZXQ7XG4gICAgICAgIHRnLnRhcmdldCA9IHVuZGVmaW5lZDtcbiAgICAgICAgLy8gVHJpZ2dlciBpZiB0aGVyZSBpcyBhIHBlbmRpbmcgcG9zaXRpb25cbiAgICAgICAgaWYgKHRnLnBlbmRpbmdQb3NpdGlvbikge1xuICAgICAgICAgIHRnLnNldFBvc2l0aW9uKHRnLnBlbmRpbmdQb3NpdGlvbi5hemltdXRoLCB0Zy5wZW5kaW5nUG9zaXRpb24uZWxldmF0aW9uLCB0Zy5wZW5kaW5nUG9zaXRpb24uZGlzdGFuY2UpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGxldCBpbnRlcnZhbElEID0gd2luZG93LnNldEludGVydmFsKGVuZFJhbXAsIDEwLCB0aGlzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIGN1cnJlbnQgcG9zaXRpb24gb2YgdGhlIHZpcnR1YWwgc291cmNlLlxuICAgKiBAcHVibGljXG4gICAqL1xuICBnZXRQb3NpdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5wb3NpdGlvbjtcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXVzZSBwbGF5aW5nLlxuICAgKiBAcHVibGljXG4gICAqL1xuICBzZXRDcm9zc2ZhZGVEdXJhdGlvbihtc1JhbXApIHtcbiAgICAvL3NhdmUgaW4gc2Vjb25kc1xuICAgIHRoaXMuY3Jvc3NmYWRlRHVyYXRpb24gPSBtc1JhbXAgLyAxMDAwO1xuICB9XG5cbiAgLyoqXG4gICAqIFNlZWsgYnVmZmVyIHBvc2l0aW9uIChpbiBzZWMpLlxuICAgKiBAcHVibGljXG4gICAqL1xuICBnZXRDcm9zc2ZhZGVEdXJhdGlvbigpIHtcbiAgICAvL3JldHVybiBpbiBtc1xuICAgIHJldHVybiB0aGlzLmNyb3NzZmFkZUR1cmF0aW9uICogMTAwMDtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIEhSVEYgZmlsZSBmb3IgYW4gZXNwZWNpZmljIHBvc2l0aW9uXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSBhemltdXRoIEF6aW11dGggaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gLTE4MCBmb3Igc291cmNlIG9uIHlvdXIgbGVmdCwgYW5kIGZyb20gMCB0byAxODAgZm9yIHNvdXJjZSBvbiB5b3VyIHJpZ2h0XG4gICAqIEBwYXJhbSBlbGV2YXRpb24gRWxldmF0aW9uIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIDkwIGZvciBzb3VyY2UgYWJvdmUgeW91ciBoZWFkLCAwIGZvciBzb3VyY2UgaW4gZnJvbnQgb2YgeW91ciBoZWFkLCBhbmQgZnJvbSAwIHRvIC05MCBmb3Igc291cmNlIGJlbG93IHlvdXIgaGVhZClcbiAgICogQHBhcmFtIGRpc3RhbmNlIERpc3RhbmNlIGluIG1ldGVyc1xuICAgKi9cbiAgZ2V0SFJURihhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKSB7XG4gICAgdmFyIG5lYXJlc3QgPSB0aGlzLmdldE5lYXJlc3RQb2ludChhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKTtcbiAgICB2YXIgaHJ0ZiA9IFtdO1xuICAgIGhydGYuaWlyX2NvZWZmc19sZWZ0ID0gbmVhcmVzdC5paXJfY29lZmZzX2xlZnQ7XG4gICAgaHJ0Zi5paXJfY29lZmZzX3JpZ2h0ID0gbmVhcmVzdC5paXJfY29lZmZzX3JpZ2h0O1xuICAgIGhydGYuaXRkID0gbmVhcmVzdC5pdGQ7XG5cbiAgICAvLyBSZXR1cm4gaHJ0ZiBkYXRhIG9mIG5lYXJlc3QgcG9zaXRpb24gZm9yIHRoZSBpbnB1dCB2YWx1ZXNcbiAgICByZXR1cm4gaHJ0ZjtcbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFuc2Zvcm0gdGhlIHNwaGVyaWNhbCB0byBjYXJ0ZXNpYW4gY29vcmRpbmF0ZXMuXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSBhemltdXRoIEF6aW11dGggaW4gcmFkaWFuc1xuICAgKiBAcGFyYW0gZWxldmF0aW9uIEVsZXZhdGlvbiBpbiByYWRpYW5zXG4gICAqIEBwYXJhbSBkaXN0YW5jZSBEaXN0YW5jZSBpbiBtZXRlcnNcbiAgICovXG4gIHNwaGVyaWNhbFRvQ2FydGVzaWFuKGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpIHtcbiAgICByZXR1cm4ge1xuICAgICAgeDogZGlzdGFuY2UgKiBNYXRoLnNpbihhemltdXRoKSxcbiAgICAgIHk6IGRpc3RhbmNlICogTWF0aC5jb3MoYXppbXV0aCksXG4gICAgICB6OiBkaXN0YW5jZSAqIE1hdGguc2luKGVsZXZhdGlvbilcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgbmVhcmVzdCBwb3NpdGlvbiBmb3IgYW4gaW5wdXQgcG9zaXRpb24uXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSBhemltdXRoIEF6aW11dGggaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gLTE4MCBmb3Igc291cmNlIG9uIHlvdXIgbGVmdCwgYW5kIGZyb20gMCB0byAxODAgZm9yIHNvdXJjZSBvbiB5b3VyIHJpZ2h0XG4gICAqIEBwYXJhbSBlbGV2YXRpb24gRWxldmF0aW9uIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIDkwIGZvciBzb3VyY2UgYWJvdmUgeW91ciBoZWFkLCAwIGZvciBzb3VyY2UgaW4gZnJvbnQgb2YgeW91ciBoZWFkLCBhbmQgZnJvbSAwIHRvIC05MCBmb3Igc291cmNlIGJlbG93IHlvdXIgaGVhZClcbiAgICogQHBhcmFtIGRpc3RhbmNlIERpc3RhbmNlIGluIG1ldGVyc1xuICAgKi9cbiAgZ2V0UmVhbENvb3JkaW5hdGVzKGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpIHtcbiAgICB2YXIgbmVhcmVzdCA9IHRoaXMuZ2V0TmVhcmVzdFBvaW50KGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpO1xuICAgIC8vIFJldHVybiBhemltdXRoLCBlbGV2YXRpb24gYW5kIGRpc3RhbmNlIG9mIG5lYXJlc3QgcG9zaXRpb24gZm9yIHRoZSBpbnB1dCB2YWx1ZXNcbiAgICByZXR1cm4ge1xuICAgICAgYXppbXV0aDogbmVhcmVzdC5hemltdXRoLFxuICAgICAgZWxldmF0aW9uOiBuZWFyZXN0LmVsZXZhdGlvbixcbiAgICAgIGRpc3RhbmNlOiBuZWFyZXN0LmRpc3RhbmNlXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIG5lYXJlc3QgcG9zaXRpb24gZm9yIGFuIGlucHV0IHBvc2l0aW9uLlxuICAgKiBAcHJpdmF0ZVxuICAgKiBAcGFyYW0gYXppbXV0aCBBemltdXRoIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIC0xODAgZm9yIHNvdXJjZSBvbiB5b3VyIGxlZnQsIGFuZCBmcm9tIDAgdG8gMTgwIGZvciBzb3VyY2Ugb24geW91ciByaWdodFxuICAgKiBAcGFyYW0gZWxldmF0aW9uIEVsZXZhdGlvbiBpbiBkZWdyZWVzICjCsCk6IGZyb20gMCB0byA5MCBmb3Igc291cmNlIGFib3ZlIHlvdXIgaGVhZCwgMCBmb3Igc291cmNlIGluIGZyb250IG9mIHlvdXIgaGVhZCwgYW5kIGZyb20gMCB0byAtOTAgZm9yIHNvdXJjZSBiZWxvdyB5b3VyIGhlYWQpXG4gICAqIEBwYXJhbSBkaXN0YW5jZSBEaXN0YW5jZSBpbiBtZXRlcnNcbiAgICovXG4gIGdldE5lYXJlc3RQb2ludChhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKSB7XG4gICAgLy8gRGVncmVlcyB0byByYWRpYW5zIGZvciB0aGUgYXppbXV0aCBhbmQgZWxldmF0aW9uXG4gICAgdmFyIGF6aW11dGhSYWRpYW5zID0gYXppbXV0aCAqIE1hdGguUEkgLyAxODA7XG4gICAgdmFyIGVsZXZhdGlvblJhZGlhbnMgPSBlbGV2YXRpb24gKiBNYXRoLlBJIC8gMTgwO1xuICAgIC8vIENvbnZlcnQgc3BoZXJpY2FsIGNvb3JkaW5hdGVzIHRvIGNhcnRlc2lhblxuICAgIHZhciBjYXJ0ZXNpYW5Db29yZCA9IHRoaXMuc3BoZXJpY2FsVG9DYXJ0ZXNpYW4oYXppbXV0aFJhZGlhbnMsIGVsZXZhdGlvblJhZGlhbnMsIGRpc3RhbmNlKTtcbiAgICAvLyBHZXQgdGhlIG5lYXJlc3QgSFJURiBmaWxlIGZvciB0aGUgZGVzaXJlZCBwb3NpdGlvblxuICAgIHZhciBuZWFyZXN0ID0gdGhpcy50cmVlLm5lYXJlc3QoY2FydGVzaWFuQ29vcmQsIDEpWzBdO1xuXG4gICAgcmV0dXJuIG5lYXJlc3RbMF07XG4gIH1cbn1cblxuXG4vKipcbiAqIEF1ZGlvR3JhcGggc3ViIGF1ZGlvIGdyYXBoIG9iamVjdCBhcyBhbiBFQ01BU2NyaXB0NSBwcm9wZXJ0aWVzIG9iamVjdC5cbiAqL1xuY2xhc3MgUHJvY2Vzc2luZ0F1ZGlvR3JhcGgge1xuICBjb25zdHJ1Y3RvcihvcHRpb25zKSB7XG4gICAgdGhpcy5hdWRpb0NvbnRleHQgPSBvcHRpb25zLmF1ZGlvQ29udGV4dDtcbiAgICAvLyBQcml2YXRlIHByb3BlcnRpZXNcbiAgICB0aGlzLmJ1ZmZlclNpemUgPSAxMDI0O1xuXG4gICAgLy8gQ3JlYXRpb25zXG4gICAgdGhpcy5pbnB1dCA9IHRoaXMuYXVkaW9Db250ZXh0LmNyZWF0ZUdhaW4oKTtcbiAgICB0aGlzLmdhaW5Ob2RlID0gdGhpcy5hdWRpb0NvbnRleHQuY3JlYXRlR2FpbigpO1xuICAgIHRoaXMuYmlxdWFkRmlsdGVyTGVmdCA9IG5ldyBCaXF1YWRGaWx0ZXIoKTtcbiAgICB0aGlzLmJpcXVhZEZpbHRlclJpZ2h0ID0gbmV3IEJpcXVhZEZpbHRlcigpO1xuICAgIHRoaXMuZnJhY3Rpb25hbERlbGF5TGVmdCA9IG5ldyBGcmFjdGlvbmFsRGVsYXkoNDQxMDApO1xuICAgIHRoaXMuZnJhY3Rpb25hbERlbGF5UmlnaHQgPSBuZXcgRnJhY3Rpb25hbERlbGF5KDQ0MTAwKTtcbiAgICB0aGlzLnByb2Nlc3Nvck5vZGUgPSB0aGlzLmF1ZGlvQ29udGV4dC5jcmVhdGVTY3JpcHRQcm9jZXNzb3IodGhpcy5idWZmZXJTaXplKTtcbiAgICAvLyBDb25uZWN0aW9uc1xuICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLnByb2Nlc3Nvck5vZGUpO1xuICAgIHRoaXMucHJvY2Vzc29yTm9kZS5jb25uZWN0KHRoaXMuZ2Fpbk5vZGUpO1xuICAgIC8vIFN0YXJ0IHByb2Nlc3Nvck5vZGVcbiAgICB0aGlzLnByb2Nlc3Nvck5vZGVGdW5jdGlvbigpO1xuICB9XG5cbiAgZ2V0IGdhaW4oKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2Fpbk5vZGUuZ2FpbjtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXQgY29lZmZpY2llbnRzIGJpcXVhZCBmaWx0ZXJcbiAgICogQHB1YmxpY1xuICAgKiBAcGFyYW0gdmFsdWUgQXVkaW9CdWZmZXIgT2JqZWN0LlxuICAgKi9cbiAgc2V0Q29lZmZpY2llbnRzKGxlZnRDb2VmZmljaWVudHMsIHJpZ2h0Q29lZmZpY2llbnRzKSB7XG4gICAgdGhpcy5iaXF1YWRGaWx0ZXJMZWZ0LnNldENvZWZmaWNpZW50cyhsZWZ0Q29lZmZpY2llbnRzKTtcbiAgICB0aGlzLmJpcXVhZEZpbHRlclJpZ2h0LnNldENvZWZmaWNpZW50cyhyaWdodENvZWZmaWNpZW50cyk7XG4gIH1cblxuICAvKipcbiAgICogU2V0IGJ1ZmZlciBhbmQgYnVmZmVyRHVyYXRpb24uXG4gICAqIEBwdWJsaWNcbiAgICogQGNoYWluYWJsZVxuICAgKi9cbiAgc2V0RGVsYXkoZGVsYXkpIHtcbiAgICB2YXIgZGVsYXlMZWZ0ID0gMSAvIDEwMDAgKyBkZWxheSAvIDI7XG4gICAgdmFyIGRlbGF5UmlnaHQgPSAxIC8gMTAwMCAtIGRlbGF5IC8gMjtcbiAgICB0aGlzLmZyYWN0aW9uYWxEZWxheUxlZnQuc2V0RGVsYXkoZGVsYXlMZWZ0KTtcbiAgICB0aGlzLmZyYWN0aW9uYWxEZWxheVJpZ2h0LnNldERlbGF5KGRlbGF5UmlnaHQpO1xuICB9XG5cbiAgcHJvY2Vzc29yTm9kZUZ1bmN0aW9uKCkge1xuICAgIHZhciB0aGF0ID0gdGhpcztcbiAgICB0aGlzLnByb2Nlc3Nvck5vZGUub25hdWRpb3Byb2Nlc3MgPSBmdW5jdGlvbihlKSB7XG4gICAgICAvLyBHZXQgdGhlIGlucHV0QnVmZmVyXG4gICAgICB2YXIgaW5wdXRBcnJheSA9IGUuaW5wdXRCdWZmZXIuZ2V0Q2hhbm5lbERhdGEoMCk7XG5cbiAgICAgIC8vIEdldCB0aGUgb3V0cHV0QnVmZmVyc1xuICAgICAgdmFyIGxlZnRPdXRwdXRBcnJheSA9IGUub3V0cHV0QnVmZmVyLmdldENoYW5uZWxEYXRhKDApO1xuICAgICAgdmFyIHJpZ2h0T3V0cHV0QXJyYXkgPSBlLm91dHB1dEJ1ZmZlci5nZXRDaGFubmVsRGF0YSgxKTtcblxuICAgICAgLy8gRGVsYXlcbiAgICAgIHZhciBtZWRpdW1BcnJheUxlZnQgPSBuZXcgRmxvYXQzMkFycmF5KHRoYXQuZnJhY3Rpb25hbERlbGF5TGVmdC5wcm9jZXNzKGlucHV0QXJyYXkpKTtcbiAgICAgIHZhciBtZWRpdW1BcnJheVJpZ2h0ID0gbmV3IEZsb2F0MzJBcnJheSh0aGF0LmZyYWN0aW9uYWxEZWxheVJpZ2h0LnByb2Nlc3MoaW5wdXRBcnJheSkpO1xuXG4gICAgICAvLyBCaXF1YWRGaWx0ZXJcbiAgICAgIHRoYXQuYmlxdWFkRmlsdGVyTGVmdC5wcm9jZXNzKG1lZGl1bUFycmF5TGVmdCwgbGVmdE91dHB1dEFycmF5KTtcbiAgICAgIHRoYXQuYmlxdWFkRmlsdGVyUmlnaHQucHJvY2VzcyhtZWRpdW1BcnJheVJpZ2h0LCByaWdodE91dHB1dEFycmF5KTtcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIENvbm5lY3QgdGhlIGNvbnZvbHZlckF1ZGlvR3JhcGggdG8gYSBub2RlXG4gICAqIEBwdWJsaWNcbiAgICogQGNoYWluYWJsZVxuICAgKiBAcGFyYW0gbm9kZSBEZXN0aW5hdGlvbiBub2RlXG4gICAqL1xuICBjb25uZWN0KG5vZGUpIHtcbiAgICB0aGlzLmdhaW5Ob2RlLmNvbm5lY3Qobm9kZSk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogRGlzY29ubmVjdCB0aGUgY29udm9sdmVyQXVkaW9HcmFwaCB0byBhIG5vZGVcbiAgICogQHB1YmxpY1xuICAgKiBAY2hhaW5hYmxlXG4gICAqIEBwYXJhbSBub2RlIERlc3RpbmF0aW9uIG5vZGVcbiAgICovXG4gIGRpc2Nvbm5lY3Qobm9kZSkge1xuICAgIHRoaXMuZ2Fpbk5vZGUuZGlzY29ubmVjdChub2RlKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxufVxuIl19