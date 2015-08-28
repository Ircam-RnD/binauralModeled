(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
// CommonJS function export
module.exports = {
  BinauralModeled: require('./dist/binaural-modeled')
};

},{"./dist/binaural-modeled":2}],2:[function(require,module,exports){
/**
 * @fileOverview
 *
 * @author Arnau Julià <Arnau.Julia@gmail.com>
 * @version 0.1.0
 */
'use strict';

var _createClass = require('babel-runtime/helpers/create-class')['default'];

var _classCallCheck = require('babel-runtime/helpers/class-call-check')['default'];

var kdt = require('kdt');
var BiquadFilter = require('biquad-filter');
var FractionalDelay = require('fractional-delay');

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
      this.tree = kdt.createKdTree(this.hrtfDataset, this.distance, ['x', 'y', 'z']);

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

var ProcessingAudioGraph = (function () {
  function ProcessingAudioGraph(options) {
    _classCallCheck(this, ProcessingAudioGraph);

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

module.exports = BinauralModeled;

},{"babel-runtime/helpers/class-call-check":4,"babel-runtime/helpers/create-class":5,"biquad-filter":8,"fractional-delay":9,"kdt":10}],3:[function(require,module,exports){
module.exports = { "default": require("core-js/library/fn/object/define-property"), __esModule: true };
},{"core-js/library/fn/object/define-property":6}],4:[function(require,module,exports){
"use strict";

exports["default"] = function (instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
};

exports.__esModule = true;
},{}],5:[function(require,module,exports){
"use strict";

var _Object$defineProperty = require("babel-runtime/core-js/object/define-property")["default"];

exports["default"] = (function () {
  function defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor) descriptor.writable = true;

      _Object$defineProperty(target, descriptor.key, descriptor);
    }
  }

  return function (Constructor, protoProps, staticProps) {
    if (protoProps) defineProperties(Constructor.prototype, protoProps);
    if (staticProps) defineProperties(Constructor, staticProps);
    return Constructor;
  };
})();

exports.__esModule = true;
},{"babel-runtime/core-js/object/define-property":3}],6:[function(require,module,exports){
var $ = require('../../modules/$');
module.exports = function defineProperty(it, key, desc){
  return $.setDesc(it, key, desc);
};
},{"../../modules/$":7}],7:[function(require,module,exports){
var $Object = Object;
module.exports = {
  create:     $Object.create,
  getProto:   $Object.getPrototypeOf,
  isEnum:     {}.propertyIsEnumerable,
  getDesc:    $Object.getOwnPropertyDescriptor,
  setDesc:    $Object.defineProperty,
  setDescs:   $Object.defineProperties,
  getKeys:    $Object.keys,
  getNames:   $Object.getOwnPropertyNames,
  getSymbols: $Object.getOwnPropertySymbols,
  each:       [].forEach
};
},{}],8:[function(require,module,exports){
(function (global){
!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.BiquadFilter=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
"use strict";
var BiquadFilter = function BiquadFilter() {
  this.coefficients = [];
  this.memories = [];
  this.numberOfCascade = 1;
  this.context = undefined;
  this.resetMemories();
  return this;
};
($traceurRuntime.createClass)(BiquadFilter, {
  setCoefficients: function(coef) {
    if (coef) {
      this.numberOfCascade = this.getNumberOfCascadeFilters(coef);
      this.coefficients = [];
      this.coefficients.g = coef[0];
      for (var i = 0; i < this.numberOfCascade; i = i + 1) {
        this.coefficients[i] = {};
        this.coefficients[i].b1 = coef[1 + i * 4];
        this.coefficients[i].b2 = coef[2 + i * 4];
        this.coefficients[i].a1 = coef[3 + i * 4];
        this.coefficients[i].a2 = coef[4 + i * 4];
      }
      this.resetMemories();
      return true;
    } else {
      console.error("No coefficients are set");
      return false;
    }
  },
  getNumberOfCascadeFilters: function(coef) {
    var numberOfCascade = (coef.length - 1) / 4;
    return numberOfCascade;
  },
  resetMemories: function() {
    this.memories = [];
    this.memories[0] = {};
    this.memories[0].xi1 = 0;
    this.memories[0].xi2 = 0;
    this.memories[0].yi1 = 0;
    this.memories[0].yi2 = 0;
    for (var i = 1; i < this.numberOfCascade; i = i + 1) {
      this.memories[i] = {};
      this.memories[i].yi1 = 0;
      this.memories[i].yi2 = 0;
    }
  },
  process: function(inputBuffer, outputBuffer) {
    var x;
    var y = [];
    var b1,
        b2,
        a1,
        a2;
    var xi1,
        xi2,
        yi1,
        yi2,
        y1i1,
        y1i2;
    for (var i = 0; i < inputBuffer.length; i = i + 1) {
      x = inputBuffer[i];
      b1 = this.coefficients[0].b1;
      b2 = this.coefficients[0].b2;
      a1 = this.coefficients[0].a1;
      a2 = this.coefficients[0].a2;
      xi1 = this.memories[0].xi1;
      xi2 = this.memories[0].xi2;
      yi1 = this.memories[0].yi1;
      yi2 = this.memories[0].yi2;
      y[0] = x + b1 * xi1 + b2 * xi2 - a1 * yi1 - a2 * yi2;
      for (var e = 1; e < this.numberOfCascade; e = e + 1) {
        b1 = this.coefficients[e].b1;
        b2 = this.coefficients[e].b2;
        a1 = this.coefficients[e].a1;
        a2 = this.coefficients[e].a2;
        y1i1 = this.memories[e - 1].yi1;
        y1i2 = this.memories[e - 1].yi2;
        yi1 = this.memories[e].yi1;
        yi2 = this.memories[e].yi2;
        y[e] = y[e - 1] + b1 * y1i1 + b2 * y1i2 - a1 * yi1 - a2 * yi2;
      }
      outputBuffer[i] = y[this.numberOfCascade - 1] * this.coefficients.g;
      this.memories[0].xi2 = this.memories[0].xi1;
      this.memories[0].xi1 = x;
      for (var p = 0; p < this.numberOfCascade; p = p + 1) {
        this.memories[p].yi2 = this.memories[p].yi1;
        this.memories[p].yi1 = y[p];
      }
    }
  }
}, {});
;
module.exports = BiquadFilter;


//# sourceURL=/Users/goldszmidt/sam/pro/dev/biquad-filter/biquad-filter.es6.js
},{}]},{},[1])(1)
});


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],9:[function(require,module,exports){
(function (global){
!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.FractionalDelay=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
"use strict";
var FractionalDelay = function FractionalDelay(sampleRate, optMaxDelayTime) {
  this.delayTime = 0;
  this.posRead = 0;
  this.posWrite = 0;
  this.fracXi1 = 0;
  this.fracYi1 = 0;
  this.intDelay = 0;
  this.fracDelay = 0;
  this.a1 = undefined;
  this.sampleRate = sampleRate;
  this.maxDelayTime = optMaxDelayTime || 1;
  this.bufferSize = this.maxDelayTime * this.sampleRate;
  if (this.bufferSize % 1 !== 0) {
    this.bufferSize = parseInt(this.bufferSize) + 1;
  }
  this.buffer = new Float32Array(this.bufferSize);
};
($traceurRuntime.createClass)(FractionalDelay, {
  setDelay: function(delayTime) {
    if (delayTime < this.maxDelayTime) {
      this.delayTime = delayTime;
      var samplesDelay = delayTime * this.sampleRate;
      this.intDelay = parseInt(samplesDelay);
      this.fracDelay = samplesDelay - this.intDelay;
      this.resample();
      if (this.fracDelay !== 0) {
        this.updateThiranCoefficient();
      }
    } else {
      throw new Error("delayTime > maxDelayTime");
    }
  },
  getDelay: function() {
    return this.delayTime;
  },
  process: function(inputBuffer) {
    var outputBuffer = new Float32Array(inputBuffer.length);
    for (var i = 0; i < inputBuffer.length; i = i + 1) {
      this.buffer[this.posWrite] = inputBuffer[i];
      outputBuffer[i] = this.buffer[this.posRead];
      this.updatePointers();
    }
    if (this.fracDelay === 0) {
      return outputBuffer;
    } else {
      outputBuffer = new Float32Array(this.fractionalThiranProcess(outputBuffer));
      return outputBuffer;
    }
  },
  updatePointers: function() {
    if (this.posWrite === (this.buffer.length - 1)) {
      this.posWrite = 0;
    } else {
      this.posWrite = this.posWrite + 1;
    }
    if (this.posRead === (this.buffer.length - 1)) {
      this.posRead = 0;
    } else {
      this.posRead = this.posRead + 1;
    }
  },
  updateThiranCoefficient: function() {
    this.a1 = (1 - this.fracDelay) / (1 + this.fracDelay);
  },
  resample: function() {
    if (this.posWrite - this.intDelay < 0) {
      var pos = this.intDelay - this.posWrite;
      this.posRead = this.buffer.length - pos;
    } else {
      this.posRead = this.posWrite - this.intDelay;
    }
  },
  fractionalThiranProcess: function(inputBuffer) {
    var outputBuffer = new Float32Array(inputBuffer.length);
    var x,
        y;
    var xi1 = this.fracXi1;
    var yi1 = this.fracYi1;
    for (var i = 0; i < inputBuffer.length; i = i + 1) {
      x = inputBuffer[i];
      y = this.a1 * x + xi1 - this.a1 * yi1;
      xi1 = x;
      yi1 = y;
      outputBuffer[i] = y;
    }
    this.fracXi1 = xi1;
    this.fracYi1 = yi1;
    return outputBuffer;
  }
}, {});
;
module.exports = FractionalDelay;


//# sourceURL=/Users/goldszmidt/sam/pro/dev/fractional-delay/fractional-delay.es6.js
},{}]},{},[1])(1)
});


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],10:[function(require,module,exports){
/**
 * AUTHOR OF INITIAL JS LIBRARY
 * k-d Tree JavaScript - V 1.0
 *
 * https://github.com/ubilabs/kd-tree-javascript
 *
 * @author Mircea Pricop <pricop@ubilabs.net>, 2012
 * @author Martin Kleppe <kleppe@ubilabs.net>, 2012
 * @author Ubilabs http://ubilabs.net, 2012
 * @license MIT License <http://www.opensource.org/licenses/mit-license.php>
 */


function Node(obj, dimension, parent) {
  this.obj = obj;
  this.left = null;
  this.right = null;
  this.parent = parent;
  this.dimension = dimension;
}

function KdTree(points, metric, dimensions) {

  var self = this;
  
  function buildTree(points, depth, parent) {
    var dim = depth % dimensions.length,
      median,
      node;

    if (points.length === 0) {
      return null;
    }
    if (points.length === 1) {
      return new Node(points[0], dim, parent);
    }

    points.sort(function (a, b) {
      return a[dimensions[dim]] - b[dimensions[dim]];
    });

    median = Math.floor(points.length / 2);
    node = new Node(points[median], dim, parent);
    node.left = buildTree(points.slice(0, median), depth + 1, node);
    node.right = buildTree(points.slice(median + 1), depth + 1, node);

    return node;
  }

  this.root = buildTree(points, 0, null);

  this.insert = function (point) {
    function innerSearch(node, parent) {

      if (node === null) {
        return parent;
      }

      var dimension = dimensions[node.dimension];
      if (point[dimension] < node.obj[dimension]) {
        return innerSearch(node.left, node);
      } else {
        return innerSearch(node.right, node);
      }
    }

    var insertPosition = innerSearch(this.root, null),
      newNode,
      dimension;

    if (insertPosition === null) {
      this.root = new Node(point, 0, null);
      return;
    }

    newNode = new Node(point, (insertPosition.dimension + 1) % dimensions.length, insertPosition);
    dimension = dimensions[insertPosition.dimension];

    if (point[dimension] < insertPosition.obj[dimension]) {
      insertPosition.left = newNode;
    } else {
      insertPosition.right = newNode;
    }
  };

  this.remove = function (point) {
    var node;

    function nodeSearch(node) {
      if (node === null) {
        return null;
      }

      if (node.obj === point) {
        return node;
      }

      var dimension = dimensions[node.dimension];

      if (point[dimension] < node.obj[dimension]) {
        return nodeSearch(node.left, node);
      } else {
        return nodeSearch(node.right, node);
      }
    }

    function removeNode(node) {
      var nextNode,
        nextObj,
        pDimension;

      function findMax(node, dim) {
        var dimension,
          own,
          left,
          right,
          max;

        if (node === null) {
          return null;
        }

        dimension = dimensions[dim];
        if (node.dimension === dim) {
          if (node.right !== null) {
            return findMax(node.right, dim);
          }
          return node;
        }

        own = node.obj[dimension];
        left = findMax(node.left, dim);
        right = findMax(node.right, dim);
        max = node;

        if (left !== null && left.obj[dimension] > own) {
          max = left;
        }

        if (right !== null && right.obj[dimension] > max.obj[dimension]) {
          max = right;
        }
        return max;
      }

      function findMin(node, dim) {
        var dimension,
          own,
          left,
          right,
          min;

        if (node === null) {
          return null;
        }

        dimension = dimensions[dim];

        if (node.dimension === dim) {
          if (node.left !== null) {
            return findMin(node.left, dim);
          }
          return node;
        }

        own = node.obj[dimension];
        left = findMin(node.left, dim);
        right = findMin(node.right, dim);
        min = node;

        if (left !== null && left.obj[dimension] < own) {
          min = left;
        }
        if (right !== null && right.obj[dimension] < min.obj[dimension]) {
          min = right;
        }
        return min;
      }

      if (node.left === null && node.right === null) {
        if (node.parent === null) {
          self.root = null;
          return;
        }

        pDimension = dimensions[node.parent.dimension];

        if (node.obj[pDimension] < node.parent.obj[pDimension]) {
          node.parent.left = null;
        } else {
          node.parent.right = null;
        }
        return;
      }

      if (node.left !== null) {
        nextNode = findMax(node.left, node.dimension);
      } else {
        nextNode = findMin(node.right, node.dimension);
      }

      nextObj = nextNode.obj;
      removeNode(nextNode);
      node.obj = nextObj;

    }

    node = nodeSearch(self.root);

    if (node === null) { return; }

    removeNode(node);
  };

  this.nearest = function (point, maxNodes, maxDistance) {
    var i,
      result,
      bestNodes;

    bestNodes = new BinaryHeap(
      function (e) { return -e[1]; }
    );

    function nearestSearch(node) {
      var bestChild,
        dimension = dimensions[node.dimension],
        ownDistance = metric(point, node.obj),
        linearPoint = {},
        linearDistance,
        otherChild,
        i;

      function saveNode(node, distance) {
        bestNodes.push([node, distance]);
        if (bestNodes.size() > maxNodes) {
          bestNodes.pop();
        }
      }

      for (i = 0; i < dimensions.length; i += 1) {
        if (i === node.dimension) {
          linearPoint[dimensions[i]] = point[dimensions[i]];
        } else {
          linearPoint[dimensions[i]] = node.obj[dimensions[i]];
        }
      }

      linearDistance = metric(linearPoint, node.obj);

      if (node.right === null && node.left === null) {
        if (bestNodes.size() < maxNodes || ownDistance < bestNodes.peek()[1]) {
          saveNode(node, ownDistance);
        }
        return;
      }

      if (node.right === null) {
        bestChild = node.left;
      } else if (node.left === null) {
        bestChild = node.right;
      } else {
        if (point[dimension] < node.obj[dimension]) {
          bestChild = node.left;
        } else {
          bestChild = node.right;
        }
      }

      nearestSearch(bestChild);

      if (bestNodes.size() < maxNodes || ownDistance < bestNodes.peek()[1]) {
        saveNode(node, ownDistance);
      }

      if (bestNodes.size() < maxNodes || Math.abs(linearDistance) < bestNodes.peek()[1]) {
        if (bestChild === node.left) {
          otherChild = node.right;
        } else {
          otherChild = node.left;
        }
        if (otherChild !== null) {
          nearestSearch(otherChild);
        }
      }
    }

    if (maxDistance) {
      for (i = 0; i < maxNodes; i += 1) {
        bestNodes.push([null, maxDistance]);
      }
    }

    nearestSearch(self.root);

    result = [];

    for (i = 0; i < maxNodes; i += 1) {
      if (bestNodes.content[i][0]) {
        result.push([bestNodes.content[i][0].obj, bestNodes.content[i][1]]);
      }
    }
    return result;
  };

  this.balanceFactor = function () {
    function height(node) {
      if (node === null) {
        return 0;
      }
      return Math.max(height(node.left), height(node.right)) + 1;
    }

    function count(node) {
      if (node === null) {
        return 0;
      }
      return count(node.left) + count(node.right) + 1;
    }

    return height(self.root) / (Math.log(count(self.root)) / Math.log(2));
  };
}

// Binary heap implementation from:
// http://eloquentjavascript.net/appendix2.html

function BinaryHeap(scoreFunction){
  this.content = [];
  this.scoreFunction = scoreFunction;
}

BinaryHeap.prototype = {
  push: function(element) {
    // Add the new element to the end of the array.
    this.content.push(element);
    // Allow it to bubble up.
    this.bubbleUp(this.content.length - 1);
  },

  pop: function() {
    // Store the first element so we can return it later.
    var result = this.content[0];
    // Get the element at the end of the array.
    var end = this.content.pop();
    // If there are any elements left, put the end element at the
    // start, and let it sink down.
    if (this.content.length > 0) {
      this.content[0] = end;
      this.sinkDown(0);
    }
    return result;
  },

  peek: function() {
    return this.content[0];
  },

  remove: function(node) {
    var len = this.content.length;
    // To remove a value, we must search through the array to find
    // it.
    for (var i = 0; i < len; i++) {
      if (this.content[i] == node) {
        // When it is found, the process seen in 'pop' is repeated
        // to fill up the hole.
        var end = this.content.pop();
        if (i != len - 1) {
          this.content[i] = end;
          if (this.scoreFunction(end) < this.scoreFunction(node))
            this.bubbleUp(i);
          else
            this.sinkDown(i);
        }
        return;
      }
    }
    throw new Error("Node not found.");
  },

  size: function() {
    return this.content.length;
  },

  bubbleUp: function(n) {
    // Fetch the element that has to be moved.
    var element = this.content[n];
    // When at 0, an element can not go up any further.
    while (n > 0) {
      // Compute the parent element's index, and fetch it.
      var parentN = Math.floor((n + 1) / 2) - 1,
          parent = this.content[parentN];
      // Swap the elements if the parent is greater.
      if (this.scoreFunction(element) < this.scoreFunction(parent)) {
        this.content[parentN] = element;
        this.content[n] = parent;
        // Update 'n' to continue at the new position.
        n = parentN;
      }
      // Found a parent that is less, no need to move it further.
      else {
        break;
      }
    }
  },

  sinkDown: function(n) {
    // Look up the target element and its score.
    var length = this.content.length,
        element = this.content[n],
        elemScore = this.scoreFunction(element);

    while(true) {
      // Compute the indices of the child elements.
      var child2N = (n + 1) * 2, child1N = child2N - 1;
      // This is used to store the new position of the element,
      // if any.
      var swap = null;
      // If the first child exists (is inside the array)...
      if (child1N < length) {
        // Look it up and compute its score.
        var child1 = this.content[child1N],
            child1Score = this.scoreFunction(child1);
        // If the score is less than our element's, we need to swap.
        if (child1Score < elemScore)
          swap = child1N;
      }
      // Do the same checks for the other child.
      if (child2N < length) {
        var child2 = this.content[child2N],
            child2Score = this.scoreFunction(child2);
        if (child2Score < (swap == null ? elemScore : child1Score)){
          swap = child2N;
        }
      }

      // If the element needs to be moved, swap it, and continue.
      if (swap != null) {
        this.content[n] = this.content[swap];
        this.content[swap] = element;
        n = swap;
      }
      // Otherwise, we are done.
      else {
        break;
      }
    }
  }
};

module.exports = {
  createKdTree: function (points, metric, dimensions) {
    return new KdTree(points, metric, dimensions)
  }
}

},{}]},{},[1])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJiaW5hdXJhbC1tb2RlbGVkLmpzIiwiZGlzdC9lczYvYmluYXVyYWwtbW9kZWxlZC5qcyIsIm5vZGVfbW9kdWxlcy9iYWJlbC1ydW50aW1lL2NvcmUtanMvb2JqZWN0L2RlZmluZS1wcm9wZXJ0eS5qcyIsIm5vZGVfbW9kdWxlcy9iYWJlbC1ydW50aW1lL2hlbHBlcnMvY2xhc3MtY2FsbC1jaGVjay5qcyIsIm5vZGVfbW9kdWxlcy9iYWJlbC1ydW50aW1lL2hlbHBlcnMvY3JlYXRlLWNsYXNzLmpzIiwibm9kZV9tb2R1bGVzL2JhYmVsLXJ1bnRpbWUvbm9kZV9tb2R1bGVzL2NvcmUtanMvbGlicmFyeS9mbi9vYmplY3QvZGVmaW5lLXByb3BlcnR5LmpzIiwibm9kZV9tb2R1bGVzL2JhYmVsLXJ1bnRpbWUvbm9kZV9tb2R1bGVzL2NvcmUtanMvbGlicmFyeS9tb2R1bGVzLyQuanMiLCIuLi8uLi91c3IvbG9jYWwvbGliL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIvVXNlcnMvZ29sZHN6bWlkdC9zYW0vcHJvL2Rldi9iaXF1YWQtZmlsdGVyL2JpcXVhZC1maWx0ZXIuZXM2LmpzIiwiL1VzZXJzL2dvbGRzem1pZHQvc2FtL3Byby9kZXYvZnJhY3Rpb25hbC1kZWxheS9mcmFjdGlvbmFsLWRlbGF5LmVzNi5qcyIsIm5vZGVfbW9kdWxlcy9rZHQvaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7Ozs7Ozs7Ozs7OztBQ0VBLElBQUksR0FBRyxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUN6QixJQUFJLFlBQVksR0FBRyxPQUFPLENBQUMsZUFBZSxDQUFDLENBQUM7QUFDNUMsSUFBSSxlQUFlLEdB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QTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8vIENvbW1vbkpTIGZ1bmN0aW9uIGV4cG9ydFxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIEJpbmF1cmFsTW9kZWxlZDogcmVxdWlyZSgnLi9kaXN0L2JpbmF1cmFsLW1vZGVsZWQnKVxufTtcbiIsIi8qKlxuICogQGZpbGVPdmVydmlld1xuICpcbiAqIEBhdXRob3IgQXJuYXUgSnVsacOgIDxBcm5hdS5KdWxpYUBnbWFpbC5jb20+XG4gKiBAdmVyc2lvbiAwLjEuMFxuICovXG52YXIga2R0ID0gcmVxdWlyZSgna2R0Jyk7XG52YXIgQmlxdWFkRmlsdGVyID0gcmVxdWlyZSgnYmlxdWFkLWZpbHRlcicpO1xudmFyIEZyYWN0aW9uYWxEZWxheSA9IHJlcXVpcmUoJ2ZyYWN0aW9uYWwtZGVsYXknKTtcblxuXG4vKipcbiAqIEBjbGFzcyBCaW5hdXJhbE1vZGVsZWRcbiAqL1xuY2xhc3MgQmluYXVyYWxNb2RlbGVkIHtcbiAgLyoqXG4gICAqIE1hbmRhdG9yeSBpbml0aWFsaXphdGlvbiBtZXRob2QuXG4gICAqIEBwdWJsaWNcbiAgICogQGNoYWluYWJsZVxuICAgKi9cbiAgY29uc3RydWN0b3Iob3B0aW9ucykge1xuICAgIHRoaXMuYXVkaW9Db250ZXh0ID0gb3B0aW9ucy5hdWRpb0NvbnRleHQ7XG4gICAgLy8gUHJpdmF0ZSBwcm9wZXJ0aWVzXG4gICAgdGhpcy5ocnRmRGF0YXNldCA9IHVuZGVmaW5lZDtcbiAgICB0aGlzLmhydGZEYXRhc2V0TGVuZ3RoID0gdW5kZWZpbmVkO1xuICAgIHRoaXMubmV4dFBvc2l0aW9uID0gW107XG4gICAgdGhpcy5jaGFuZ2VXaGVuRmluaXNoQ3Jvc3NmYWRpbmcgPSBmYWxzZTtcbiAgICB0aGlzLnBvc2l0aW9uID0gW107XG4gICAgdGhpcy5jcm9zc2ZhZGVEdXJhdGlvbiA9IDIwIC8gMTAwMDtcbiAgICB0aGlzLmJ1ZmZlclNpemUgPSAxMDI0O1xuICAgIHRoaXMudHJlZSA9IC0xO1xuXG4gICAgdGhpcy5pbnB1dCA9IHRoaXMuYXVkaW9Db250ZXh0LmNyZWF0ZUdhaW4oKTtcblxuICAgIC8vIFR3byBzdWIgYXVkaW8gZ3JhcGhzIGNyZWF0aW9uOlxuICAgIC8vIC0gbWFpbkNvbnZvbHZlciB3aGljaCByZXByZXNlbnRzIHRoZSBjdXJyZW50IHN0YXRlXG4gICAgLy8gLSBhbmQgc2Vjb25kYXJ5Q29udm9sdmVyIHdoaWNoIHJlcHJlc2VudHMgdGhlIHBvdGVudGlhbCB0YXJnZXQgc3RhdGVcbiAgICAvLyAgIHdoZW4gbW92aW5nIHNvdW5kIHRvIGEgbmV3IHBvc2l0aW9uXG5cbiAgICB0aGlzLm1haW5BdWRpb0dyYXBoID0gbmV3IFByb2Nlc3NpbmdBdWRpb0dyYXBoKHtcbiAgICAgIGF1ZGlvQ29udGV4dDogdGhpcy5hdWRpb0NvbnRleHRcbiAgICB9KTtcbiAgICB0aGlzLm1haW5BdWRpb0dyYXBoLmdhaW4udmFsdWUgPSAxO1xuICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLm1haW5BdWRpb0dyYXBoLmlucHV0KTtcblxuICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaCA9IG5ldyBQcm9jZXNzaW5nQXVkaW9HcmFwaCh7XG4gICAgICBhdWRpb0NvbnRleHQ6IHRoaXMuYXVkaW9Db250ZXh0XG4gICAgfSk7XG4gICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLmdhaW4udmFsdWUgPSAwO1xuICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguaW5wdXQpO1xuICAgIC8vIFdlYiBBdWRpb1xuICAgIHRoaXMuc2FtcGxlUmF0ZSA9IHRoaXMuYXVkaW9Db250ZXh0LnNhbXBsZVJhdGU7XG4gICAgLy9Db25uZWN0aW9uc1xuICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLm1haW5BdWRpb0dyYXBoLmlucHV0KTtcbiAgICB0aGlzLmlucHV0LmNvbm5lY3QodGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLmlucHV0KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25uZWN0cyB0aGUgYmluYXVyYWxNb2RlbGVkTm9kZSB0byB0aGUgV2ViIEF1ZGlvIGdyYXBoXG4gICAqIEBwdWJsaWNcbiAgICogQGNoYWluYWJsZVxuICAgKiBAcGFyYW0gbm9kZSBEZXN0aW5hdGlvbiBub2RlXG4gICAqL1xuICBjb25uZWN0KG5vZGUpIHtcbiAgICB0aGlzLm1haW5BdWRpb0dyYXBoLmNvbm5lY3Qobm9kZSk7XG4gICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLmNvbm5lY3Qobm9kZSk7XG4gICAgcmV0dXJuIHRoaXM7IC8vIEZvciBjaGFpbmFiaWxpdHlcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNjb25uZWN0IHRoZSBiaW5hdXJhbE1vZGVsZWROb2RlIGZyb20gdGhlIFdlYiBBdWRpbyBncmFwaFxuICAgKiBAcHVibGljXG4gICAqIEBjaGFpbmFibGVcbiAgICogQHBhcmFtIG5vZGUgRGVzdGluYXRpb24gbm9kZVxuICAgKi9cbiAgZGlzY29ubmVjdChub2RlKSB7XG4gICAgdGhpcy5tYWluQXVkaW9HcmFwaC5kaXNjb25uZWN0KG5vZGUpO1xuICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5kaXNjb25uZWN0KG5vZGUpO1xuICAgIHJldHVybiB0aGlzOyAvLyBGb3IgY2hhaW5hYmlsaXR5XG4gIH1cblxuICAvKipcbiAgICogU2V0IEhSVEYgRGF0YXNldCB0byBiZSB1c2VkIHdpdGggdGhlIHZpcnR1YWwgc291cmNlLlxuICAgKiBAcHVibGljXG4gICAqIEBjaGFpbmFibGVcbiAgICogQHBhcmFtIGhydGZEYXRhc2V0IEFycmF5IG9mIE9iamVjdHMgY29udGFpbmluZyB0aGUgYXppbXV0aCwgZGlzdGFuY2UsIGVsZXZhdGlvbiwgdXJsIGFuZCBidWZmZXIgZm9yIGVhY2ggcG9pbnRcbiAgICovXG4gIHNldCBIUlRGRGF0YXNldChocnRmRGF0YXNldCkge1xuICAgIHRoaXMuaHJ0ZkRhdGFzZXQgPSBocnRmRGF0YXNldDtcbiAgICB0aGlzLmhydGZEYXRhc2V0TGVuZ3RoID0gdGhpcy5ocnRmRGF0YXNldC5sZW5ndGg7XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuaHJ0ZkRhdGFzZXRMZW5ndGg7IGkrKykge1xuICAgICAgdmFyIGhydGYgPSB0aGlzLmhydGZEYXRhc2V0W2ldO1xuICAgICAgLy8gQXppbXV0aCBhbmQgZWxldmF0aW9uIHRvIHJhZGlhbnNcbiAgICAgIHZhciBhemltdXRoUmFkaWFucyA9IGhydGYuYXppbXV0aCAqIE1hdGguUEkgLyAxODA7XG4gICAgICB2YXIgZWxldmF0aW9uUmFkaWFucyA9IGhydGYuZWxldmF0aW9uICogTWF0aC5QSSAvIDE4MDtcbiAgICAgIHZhciBjYXRlc2lhbkNvb3JkID0gdGhpcy5zcGhlcmljYWxUb0NhcnRlc2lhbihhemltdXRoUmFkaWFucywgZWxldmF0aW9uUmFkaWFucywgaHJ0Zi5kaXN0YW5jZSk7XG4gICAgICBocnRmLnggPSBjYXRlc2lhbkNvb3JkLng7XG4gICAgICBocnRmLnkgPSBjYXRlc2lhbkNvb3JkLnk7XG4gICAgICBocnRmLnogPSBjYXRlc2lhbkNvb3JkLno7XG4gICAgfVxuICAgIHRoaXMudHJlZSA9IGtkdC5jcmVhdGVLZFRyZWUodGhpcy5ocnRmRGF0YXNldCwgdGhpcy5kaXN0YW5jZSwgWyd4JywgJ3knLCAneiddKTtcblxuICAgIC8vIFB1dCBkZWZhdWx0IHZhbHVlc1xuICAgIHZhciBocnRmTmV4dFBvc2l0aW9uID0gdGhpcy5nZXRIUlRGKDAsIDAsIDEpO1xuICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5zZXRDb2VmZmljaWVudHMoaHJ0Zk5leHRQb3NpdGlvbi5paXJfY29lZmZzX2xlZnQsIGhydGZOZXh0UG9zaXRpb24uaWlyX2NvZWZmc19yaWdodCk7XG4gICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLnNldERlbGF5KGhydGZOZXh0UG9zaXRpb24uaXRkIC8gMTAwMCk7XG4gICAgdGhpcy5tYWluQXVkaW9HcmFwaC5zZXRDb2VmZmljaWVudHMoaHJ0Zk5leHRQb3NpdGlvbi5paXJfY29lZmZzX2xlZnQsIGhydGZOZXh0UG9zaXRpb24uaWlyX2NvZWZmc19yaWdodCk7XG4gICAgdGhpcy5tYWluQXVkaW9HcmFwaC5zZXREZWxheShocnRmTmV4dFBvc2l0aW9uLml0ZCAvIDEwMDApO1xuICB9XG4gIGdldCBIUlRGRGF0YXNldCgpIHtcbiAgICByZXR1cm4gdGhpcy5ocnRmRGF0YXNldDtcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxjdWxhdGUgdGhlIGRpc3RhbmNlIGJldHdlZW4gdHdvIHBvaW50cyBpbiBhIDMtRCBzcGFjZS5cbiAgICogQHByaXZhdGVcbiAgICogQGNoYWluYWJsZVxuICAgKiBAcGFyYW0gYSBPYmplY3QgY29udGFpbmluZyB0aHJlZSBwcm9wZXJ0aWVzOiB4LCB5LCB6XG4gICAqIEBwYXJhbSBiIE9iamVjdCBjb250YWluaW5nIHRocmVlIHByb3BlcnRpZXM6IHgsIHksIHpcbiAgICovXG4gIGRpc3RhbmNlKGEsIGIpIHtcbiAgICAvLyBObyBuZWVkIHRvIGNvbXB1dGUgc3F1YXJlIHJvb3QgaGVyZSBmb3IgZGlzdGFuY2UgY29tcGFyaXNvbiwgdGhpcyBpcyBtb3JlIGVmaWNpZW50LlxuICAgIHJldHVybiBNYXRoLnBvdyhhLnggLSBiLngsIDIpICsgTWF0aC5wb3coYS55IC0gYi55LCAyKSArIE1hdGgucG93KGEueiAtIGIueiwgMik7XG4gIH1cblxuICAvKipcbiAgICogU2V0IGdhaW4gdmFsdWUgYW5kIHNxdWFyZWQgdm9sdW1lLlxuICAgKiBAcHJpdmF0ZVxuICAgKiBAY2hhaW5hYmxlXG4gICAqIEB0b2RvIDogcmVhbG1lbnQgdmEgYXF1w60gYWl4w7I/XG4gICAqL1xuICBzZXRMYXN0UG9zaXRpb24oKSB7XG4gICAgaWYgKCF0aGlzLmlzQ3Jvc3NmYWRpbmcoKSkge1xuICAgICAgdGhpcy5jaGFuZ2VXaGVuRmluaXNoQ3Jvc3NmYWRpbmcgPSBmYWxzZTtcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5pbnRlcnZhbElEKTtcbiAgICAgIHRoaXMucmVhbGx5U3RhcnRQb3NpdGlvbigpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDcm9zc2ZhZGluZ1xuICAgKiBAcHJpdmF0ZVxuICAgKiBAY2hhaW5hYmxlXG4gICAqL1xuICBjcm9zc2ZhZGluZygpIHtcbiAgICAvLyBEbyB0aGUgY3Jvc3NmYWRpbmcgYmV0d2VlbiBtYWluQXVkaW9HcmFwaCBhbmQgc2Vjb25kYXJ5QXVkaW9HcmFwaFxuICAgIHZhciBub3cgPSB0aGlzLmF1ZGlvQ29udGV4dC5jdXJyZW50VGltZTtcbiAgICAvLyBXYWl0IHR3byBidWZmZXJzIHVudGlsIGRvIHRoZSBjaGFuZ2UgKHNjcmlwdFByb2Nlc3Nvck5vZGUgb25seSB1cGRhdGUgdGhlIHZhcmlhYmxlcyBhdCB0aGUgZmlyc3Qgc2FtcGxlIG9mIHRoZSBidWZmZXIpXG4gICAgdGhpcy5tYWluQXVkaW9HcmFwaC5nYWluLnNldFZhbHVlQXRUaW1lKDEsIG5vdyArIDIgKiB0aGlzLmJ1ZmZlclNpemUgLyB0aGlzLnNhbXBsZVJhdGUpO1xuICAgIHRoaXMubWFpbkF1ZGlvR3JhcGguZ2Fpbi5saW5lYXJSYW1wVG9WYWx1ZUF0VGltZSgwLCBub3cgKyB0aGlzLmNyb3NzZmFkZUR1cmF0aW9uICsgMiAqIHRoaXMuYnVmZmVyU2l6ZSAvIHRoaXMuc2FtcGxlUmF0ZSk7XG5cbiAgICB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguZ2Fpbi5zZXRWYWx1ZUF0VGltZSgwLCBub3cgKyAyICogdGhpcy5idWZmZXJTaXplIC8gdGhpcy5zYW1wbGVSYXRlKTtcbiAgICB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguZ2Fpbi5saW5lYXJSYW1wVG9WYWx1ZUF0VGltZSgxLCBub3cgKyB0aGlzLmNyb3NzZmFkZUR1cmF0aW9uICsgMiAqIHRoaXMuYnVmZmVyU2l6ZSAvIHRoaXMuc2FtcGxlUmF0ZSk7XG4gIH1cblxuICAvKipcbiAgICogU2V0IHBvc2l0aW9uIG9mIHRoZSB2aXJ0dWFsIHNvdXJjZVxuICAgKiBAcHVibGljXG4gICAqIEBjaGFpbmFibGVcbiAgICogQHBhcmFtIGF6aW11dGggQXppbXV0aCBpbiBkZWdyZWVzICjCsCk6IGZyb20gMCB0byAtMTgwIGZvciBzb3VyY2Ugb24geW91ciBsZWZ0LCBhbmQgZnJvbSAwIHRvIDE4MCBmb3Igc291cmNlIG9uIHlvdXIgcmlnaHRcbiAgICogQHBhcmFtIGVsZXZhdGlvbiBFbGV2YXRpb24gaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gOTAgZm9yIHNvdXJjZSBhYm92ZSB5b3VyIGhlYWQsIDAgZm9yIHNvdXJjZSBpbiBmcm9udCBvZiB5b3VyIGhlYWQsIGFuZCBmcm9tIDAgdG8gLTkwIGZvciBzb3VyY2UgYmVsb3cgeW91ciBoZWFkKVxuICAgKiBAcGFyYW0gZGlzdGFuY2UgRGlzdGFuY2UgaW4gbWV0ZXJzXG4gICAqL1xuICBzZXRQb3NpdGlvbihhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKSB7XG5cbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMykge1xuICAgICAgLy8gQ2FsY3VsYXRlIHRoZSBuZWFyZXN0IHBvc2l0aW9uIGZvciB0aGUgaW5wdXQgYXppbXV0aCwgZWxldmF0aW9uIGFuZCBkaXN0YW5jZVxuICAgICAgdmFyIG5lYXJlc3RQb3NpdGlvbiA9IHRoaXMuZ2V0UmVhbENvb3JkaW5hdGVzKGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpO1xuICAgICAgLy8gTm8gbmVlZCB0byBjaGFuZ2UgdGhlIGN1cnJlbnQgSFJURiBsb2FkZWQgaWYgc2V0dGVkIHBvc2l0aW9uIGVxdWFsIGN1cnJlbnQgcG9zaXRpb25cbiAgICAgIGlmIChuZWFyZXN0UG9zaXRpb24uYXppbXV0aCAhPT0gdGhpcy5wb3NpdGlvbi5hemltdXRoIHx8IG5lYXJlc3RQb3NpdGlvbi5lbGV2YXRpb24gIT09IHRoaXMucG9zaXRpb24uZWxldmF0aW9uIHx8IG5lYXJlc3RQb3NpdGlvbi5kaXN0YW5jZSAhPT0gdGhpcy5wb3NpdGlvbi5kaXN0YW5jZSkge1xuICAgICAgICAvLyBDaGVjayBpZiB0aGUgY3Jvc3NmYWRpbmcgaXMgYWN0aXZlXG4gICAgICAgIGlmICh0aGlzLmlzQ3Jvc3NmYWRpbmcoKSA9PT0gdHJ1ZSkge1xuICAgICAgICAgIC8vIENoZWNrIGlmIHRoZXJlIGlzIGEgdmFsdWUgd2FpdGluZyB0byBiZSBzZXRcbiAgICAgICAgICBpZiAodGhpcy5jaGFuZ2VXaGVuRmluaXNoQ3Jvc3NmYWRpbmcgPT09IHRydWUpIHtcbiAgICAgICAgICAgIC8vIFN0b3AgdGhlIHBhc3Qgc2V0SW50ZXJ2YWwgZXZlbnQuXG4gICAgICAgICAgICBjbGVhckludGVydmFsKHRoaXMuaW50ZXJ2YWxJRCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuY2hhbmdlV2hlbkZpbmlzaENyb3NzZmFkaW5nID0gdHJ1ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBTYXZlIHRoZSBwb3NpdGlvblxuICAgICAgICAgIHRoaXMubmV4dFBvc2l0aW9uLmF6aW11dGggPSBuZWFyZXN0UG9zaXRpb24uYXppbXV0aDtcbiAgICAgICAgICB0aGlzLm5leHRQb3NpdGlvbi5lbGV2YXRpb24gPSBuZWFyZXN0UG9zaXRpb24uZWxldmF0aW9uO1xuICAgICAgICAgIHRoaXMubmV4dFBvc2l0aW9uLmRpc3RhbmNlID0gbmVhcmVzdFBvc2l0aW9uLmRpc3RhbmNlO1xuXG4gICAgICAgICAgLy8gU3RhcnQgdGhlIHNldEludGVydmFsOiB3YWl0IHVudGlsIHRoZSBjcm9zc2ZhZGluZyBpcyBmaW5pc2hlZC5cbiAgICAgICAgICB0aGlzLmludGVydmFsSUQgPSB3aW5kb3cuc2V0SW50ZXJ2YWwodGhpcy5zZXRMYXN0UG9zaXRpb24uYmluZCh0aGlzKSwgMC4wMDUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMubmV4dFBvc2l0aW9uLmF6aW11dGggPSBuZWFyZXN0UG9zaXRpb24uYXppbXV0aDtcbiAgICAgICAgICB0aGlzLm5leHRQb3NpdGlvbi5lbGV2YXRpb24gPSBuZWFyZXN0UG9zaXRpb24uZWxldmF0aW9uO1xuICAgICAgICAgIHRoaXMubmV4dFBvc2l0aW9uLmRpc3RhbmNlID0gbmVhcmVzdFBvc2l0aW9uLmRpc3RhbmNlO1xuICAgICAgICAgIHRoaXMucmVhbGx5U3RhcnRQb3NpdGlvbigpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzOyAvLyBGb3IgY2hhaW5hYmlsaXR5XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWxseSBjaGFuZ2UgdGhlIHBvc2l0aW9uXG4gICAqIEBwcml2YXRlXG4gICAqL1xuICByZWFsbHlTdGFydFBvc2l0aW9uKCkge1xuICAgIC8vIFNhdmUgdGhlIGN1cnJlbnQgcG9zaXRpb25cbiAgICB0aGlzLnBvc2l0aW9uLmF6aW11dGggPSB0aGlzLm5leHRQb3NpdGlvbi5hemltdXRoO1xuICAgIHRoaXMucG9zaXRpb24uZWxldmF0aW9uID0gdGhpcy5uZXh0UG9zaXRpb24uZWxldmF0aW9uO1xuICAgIHRoaXMucG9zaXRpb24uZGlzdGFuY2UgPSB0aGlzLm5leHRQb3NpdGlvbi5kaXN0YW5jZTtcblxuICAgIHZhciBocnRmTmV4dFBvc2l0aW9uID0gdGhpcy5nZXRIUlRGKHRoaXMucG9zaXRpb24uYXppbXV0aCwgdGhpcy5wb3NpdGlvbi5lbGV2YXRpb24sIHRoaXMucG9zaXRpb24uZGlzdGFuY2UpO1xuICAgIC8vIExvYWQgdGhlIG5ldyBwb3NpdGlvbiBpbiB0aGUgYmlxdWFkIGFuZCBkZWxheSBub3QgYWN0aXZlIChzZWNvbmRhcnlBdWRpb0dyYXBoKVxuICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5zZXRDb2VmZmljaWVudHMoaHJ0Zk5leHRQb3NpdGlvbi5paXJfY29lZmZzX2xlZnQsIGhydGZOZXh0UG9zaXRpb24uaWlyX2NvZWZmc19yaWdodCk7XG4gICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLnNldERlbGF5KGhydGZOZXh0UG9zaXRpb24uaXRkIC8gMTAwMCk7XG5cbiAgICAvLyBEbyB0aGUgY3Jvc3NmYWRpbmcgYmV0d2VlbiBtYWluQXVkaW9HcmFwaCBhbmQgc2Vjb25kYXJ5QXVkaW9HcmFwaFxuICAgIHRoaXMuY3Jvc3NmYWRpbmcoKTtcblxuICAgIC8vIENoYW5nZSBjdXJyZW50IG1haW5BdWRpb0dyYXBoXG4gICAgdmFyIGFjdGl2ZSA9IHRoaXMubWFpbkF1ZGlvR3JhcGg7XG4gICAgdGhpcy5tYWluQXVkaW9HcmFwaCA9IHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaDtcbiAgICB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGggPSBhY3RpdmU7XG4gIH1cblxuICAvKipcbiAgICogR2V0IHRoZSBjdXJyZW50IHBvc2l0aW9uIG9mIHRoZSB2aXJ0dWFsIHNvdXJjZS5cbiAgICogQHB1YmxpY1xuICAgKi9cbiAgZ2V0UG9zaXRpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMucG9zaXRpb247XG4gIH1cblxuICAvKipcbiAgICogUGF1c2UgcGxheWluZy5cbiAgICogQHB1YmxpY1xuICAgKi9cbiAgc2V0Q3Jvc3NmYWRlRHVyYXRpb24obXNSYW1wKSB7XG4gICAgLy9zYXZlIGluIHNlY29uZHNcbiAgICB0aGlzLmNyb3NzZmFkZUR1cmF0aW9uID0gbXNSYW1wIC8gMTAwMDtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZWVrIGJ1ZmZlciBwb3NpdGlvbiAoaW4gc2VjKS5cbiAgICogQHB1YmxpY1xuICAgKi9cbiAgZ2V0Q3Jvc3NmYWRlRHVyYXRpb24oKSB7XG4gICAgLy9yZXR1cm4gaW4gbXNcbiAgICByZXR1cm4gdGhpcy5jcm9zc2ZhZGVEdXJhdGlvbiAqIDEwMDA7XG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZSBwbGF5aW5nIGZsYWcgd2hlbiB0aGUgZW5kIG9mIHRoZSBidWZmZXIgaXMgcmVhY2hlZC5cbiAgICogQHB1YmxpY1xuICAgKiBAdG9kbyBIYW5kbGUgc3BlZWQgY2hhbmdlcy5cbiAgICovXG4gIGlzQ3Jvc3NmYWRpbmcoKSB7XG4gICAgLy8gVGhlIHJhbXBzIGFyZSBub3QgZmluaXNoZWQsIHNvIHRoZSBjcm9zc2ZhZGluZyBpcyBub3QgZmluaXNoZWRcbiAgICBpZiAodGhpcy5tYWluQXVkaW9HcmFwaC5nYWluLnZhbHVlICE9PSAxKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIEhSVEYgZmlsZSBmb3IgYW4gZXNwZWNpZmljIHBvc2l0aW9uXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSBhemltdXRoIEF6aW11dGggaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gLTE4MCBmb3Igc291cmNlIG9uIHlvdXIgbGVmdCwgYW5kIGZyb20gMCB0byAxODAgZm9yIHNvdXJjZSBvbiB5b3VyIHJpZ2h0XG4gICAqIEBwYXJhbSBlbGV2YXRpb24gRWxldmF0aW9uIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIDkwIGZvciBzb3VyY2UgYWJvdmUgeW91ciBoZWFkLCAwIGZvciBzb3VyY2UgaW4gZnJvbnQgb2YgeW91ciBoZWFkLCBhbmQgZnJvbSAwIHRvIC05MCBmb3Igc291cmNlIGJlbG93IHlvdXIgaGVhZClcbiAgICogQHBhcmFtIGRpc3RhbmNlIERpc3RhbmNlIGluIG1ldGVyc1xuICAgKi9cbiAgZ2V0SFJURihhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKSB7XG4gICAgdmFyIG5lYXJlc3QgPSB0aGlzLmdldE5lYXJlc3RQb2ludChhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKTtcbiAgICB2YXIgaHJ0ZiA9IFtdO1xuICAgIGhydGYuaWlyX2NvZWZmc19sZWZ0ID0gbmVhcmVzdC5paXJfY29lZmZzX2xlZnQ7XG4gICAgaHJ0Zi5paXJfY29lZmZzX3JpZ2h0ID0gbmVhcmVzdC5paXJfY29lZmZzX3JpZ2h0O1xuICAgIGhydGYuaXRkID0gbmVhcmVzdC5pdGQ7XG5cbiAgICAvLyBSZXR1cm4gaHJ0ZiBkYXRhIG9mIG5lYXJlc3QgcG9zaXRpb24gZm9yIHRoZSBpbnB1dCB2YWx1ZXNcbiAgICByZXR1cm4gaHJ0ZjtcbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFuc2Zvcm0gdGhlIHNwaGVyaWNhbCB0byBjYXJ0ZXNpYW4gY29vcmRpbmF0ZXMuXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSBhemltdXRoIEF6aW11dGggaW4gcmFkaWFuc1xuICAgKiBAcGFyYW0gZWxldmF0aW9uIEVsZXZhdGlvbiBpbiByYWRpYW5zXG4gICAqIEBwYXJhbSBkaXN0YW5jZSBEaXN0YW5jZSBpbiBtZXRlcnNcbiAgICovXG4gIHNwaGVyaWNhbFRvQ2FydGVzaWFuKGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpIHtcbiAgICByZXR1cm4ge1xuICAgICAgeDogZGlzdGFuY2UgKiBNYXRoLnNpbihhemltdXRoKSxcbiAgICAgIHk6IGRpc3RhbmNlICogTWF0aC5jb3MoYXppbXV0aCksXG4gICAgICB6OiBkaXN0YW5jZSAqIE1hdGguc2luKGVsZXZhdGlvbilcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgbmVhcmVzdCBwb3NpdGlvbiBmb3IgYW4gaW5wdXQgcG9zaXRpb24uXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSBhemltdXRoIEF6aW11dGggaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gLTE4MCBmb3Igc291cmNlIG9uIHlvdXIgbGVmdCwgYW5kIGZyb20gMCB0byAxODAgZm9yIHNvdXJjZSBvbiB5b3VyIHJpZ2h0XG4gICAqIEBwYXJhbSBlbGV2YXRpb24gRWxldmF0aW9uIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIDkwIGZvciBzb3VyY2UgYWJvdmUgeW91ciBoZWFkLCAwIGZvciBzb3VyY2UgaW4gZnJvbnQgb2YgeW91ciBoZWFkLCBhbmQgZnJvbSAwIHRvIC05MCBmb3Igc291cmNlIGJlbG93IHlvdXIgaGVhZClcbiAgICogQHBhcmFtIGRpc3RhbmNlIERpc3RhbmNlIGluIG1ldGVyc1xuICAgKi9cbiAgZ2V0UmVhbENvb3JkaW5hdGVzKGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpIHtcbiAgICB2YXIgbmVhcmVzdCA9IHRoaXMuZ2V0TmVhcmVzdFBvaW50KGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpO1xuICAgIC8vIFJldHVybiBhemltdXRoLCBlbGV2YXRpb24gYW5kIGRpc3RhbmNlIG9mIG5lYXJlc3QgcG9zaXRpb24gZm9yIHRoZSBpbnB1dCB2YWx1ZXNcbiAgICByZXR1cm4ge1xuICAgICAgYXppbXV0aDogbmVhcmVzdC5hemltdXRoLFxuICAgICAgZWxldmF0aW9uOiBuZWFyZXN0LmVsZXZhdGlvbixcbiAgICAgIGRpc3RhbmNlOiBuZWFyZXN0LmRpc3RhbmNlXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIG5lYXJlc3QgcG9zaXRpb24gZm9yIGFuIGlucHV0IHBvc2l0aW9uLlxuICAgKiBAcHJpdmF0ZVxuICAgKiBAcGFyYW0gYXppbXV0aCBBemltdXRoIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIC0xODAgZm9yIHNvdXJjZSBvbiB5b3VyIGxlZnQsIGFuZCBmcm9tIDAgdG8gMTgwIGZvciBzb3VyY2Ugb24geW91ciByaWdodFxuICAgKiBAcGFyYW0gZWxldmF0aW9uIEVsZXZhdGlvbiBpbiBkZWdyZWVzICjCsCk6IGZyb20gMCB0byA5MCBmb3Igc291cmNlIGFib3ZlIHlvdXIgaGVhZCwgMCBmb3Igc291cmNlIGluIGZyb250IG9mIHlvdXIgaGVhZCwgYW5kIGZyb20gMCB0byAtOTAgZm9yIHNvdXJjZSBiZWxvdyB5b3VyIGhlYWQpXG4gICAqIEBwYXJhbSBkaXN0YW5jZSBEaXN0YW5jZSBpbiBtZXRlcnNcbiAgICovXG4gIGdldE5lYXJlc3RQb2ludChhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKSB7XG4gICAgLy8gRGVncmVlcyB0byByYWRpYW5zIGZvciB0aGUgYXppbXV0aCBhbmQgZWxldmF0aW9uXG4gICAgdmFyIGF6aW11dGhSYWRpYW5zID0gYXppbXV0aCAqIE1hdGguUEkgLyAxODA7XG4gICAgdmFyIGVsZXZhdGlvblJhZGlhbnMgPSBlbGV2YXRpb24gKiBNYXRoLlBJIC8gMTgwO1xuICAgIC8vIENvbnZlcnQgc3BoZXJpY2FsIGNvb3JkaW5hdGVzIHRvIGNhcnRlc2lhblxuICAgIHZhciBjYXJ0ZXNpYW5Db29yZCA9IHRoaXMuc3BoZXJpY2FsVG9DYXJ0ZXNpYW4oYXppbXV0aFJhZGlhbnMsIGVsZXZhdGlvblJhZGlhbnMsIGRpc3RhbmNlKTtcbiAgICAvLyBHZXQgdGhlIG5lYXJlc3QgSFJURiBmaWxlIGZvciB0aGUgZGVzaXJlZCBwb3NpdGlvblxuICAgIHZhciBuZWFyZXN0ID0gdGhpcy50cmVlLm5lYXJlc3QoY2FydGVzaWFuQ29vcmQsIDEpWzBdO1xuXG4gICAgcmV0dXJuIG5lYXJlc3RbMF07XG4gIH1cbn1cblxuXG4vKipcbiAqIEF1ZGlvR3JhcGggc3ViIGF1ZGlvIGdyYXBoIG9iamVjdCBhcyBhbiBFQ01BU2NyaXB0NSBwcm9wZXJ0aWVzIG9iamVjdC5cbiAqL1xuY2xhc3MgUHJvY2Vzc2luZ0F1ZGlvR3JhcGgge1xuICBjb25zdHJ1Y3RvcihvcHRpb25zKSB7XG4gICAgdGhpcy5hdWRpb0NvbnRleHQgPSBvcHRpb25zLmF1ZGlvQ29udGV4dDtcbiAgICAvLyBQcml2YXRlIHByb3BlcnRpZXNcbiAgICB0aGlzLmJ1ZmZlclNpemUgPSAxMDI0O1xuXG4gICAgLy8gQ3JlYXRpb25zXG4gICAgdGhpcy5pbnB1dCA9IHRoaXMuYXVkaW9Db250ZXh0LmNyZWF0ZUdhaW4oKTtcbiAgICB0aGlzLmdhaW5Ob2RlID0gdGhpcy5hdWRpb0NvbnRleHQuY3JlYXRlR2FpbigpO1xuICAgIHRoaXMuYmlxdWFkRmlsdGVyTGVmdCA9IG5ldyBCaXF1YWRGaWx0ZXIoKTtcbiAgICB0aGlzLmJpcXVhZEZpbHRlclJpZ2h0ID0gbmV3IEJpcXVhZEZpbHRlcigpO1xuICAgIHRoaXMuZnJhY3Rpb25hbERlbGF5TGVmdCA9IG5ldyBGcmFjdGlvbmFsRGVsYXkoNDQxMDApO1xuICAgIHRoaXMuZnJhY3Rpb25hbERlbGF5UmlnaHQgPSBuZXcgRnJhY3Rpb25hbERlbGF5KDQ0MTAwKTtcbiAgICB0aGlzLnByb2Nlc3Nvck5vZGUgPSB0aGlzLmF1ZGlvQ29udGV4dC5jcmVhdGVTY3JpcHRQcm9jZXNzb3IodGhpcy5idWZmZXJTaXplKTtcbiAgICAvLyBDb25uZWN0aW9uc1xuICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLnByb2Nlc3Nvck5vZGUpO1xuICAgIHRoaXMucHJvY2Vzc29yTm9kZS5jb25uZWN0KHRoaXMuZ2Fpbk5vZGUpO1xuICAgIC8vIFN0YXJ0IHByb2Nlc3Nvck5vZGVcbiAgICB0aGlzLnByb2Nlc3Nvck5vZGVGdW5jdGlvbigpO1xuICB9XG5cbiAgZ2V0IGdhaW4oKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2Fpbk5vZGUuZ2FpbjtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXQgY29lZmZpY2llbnRzIGJpcXVhZCBmaWx0ZXJcbiAgICogQHB1YmxpY1xuICAgKiBAcGFyYW0gdmFsdWUgQXVkaW9CdWZmZXIgT2JqZWN0LlxuICAgKi9cbiAgc2V0Q29lZmZpY2llbnRzKGxlZnRDb2VmZmljaWVudHMsIHJpZ2h0Q29lZmZpY2llbnRzKSB7XG4gICAgdGhpcy5iaXF1YWRGaWx0ZXJMZWZ0LnNldENvZWZmaWNpZW50cyhsZWZ0Q29lZmZpY2llbnRzKTtcbiAgICB0aGlzLmJpcXVhZEZpbHRlclJpZ2h0LnNldENvZWZmaWNpZW50cyhyaWdodENvZWZmaWNpZW50cyk7XG4gIH1cblxuICAvKipcbiAgICogU2V0IGJ1ZmZlciBhbmQgYnVmZmVyRHVyYXRpb24uXG4gICAqIEBwdWJsaWNcbiAgICogQGNoYWluYWJsZVxuICAgKi9cbiAgc2V0RGVsYXkoZGVsYXkpIHtcbiAgICB2YXIgZGVsYXlMZWZ0ID0gMSAvIDEwMDAgKyBkZWxheSAvIDI7XG4gICAgdmFyIGRlbGF5UmlnaHQgPSAxIC8gMTAwMCAtIGRlbGF5IC8gMjtcbiAgICB0aGlzLmZyYWN0aW9uYWxEZWxheUxlZnQuc2V0RGVsYXkoZGVsYXlMZWZ0KTtcbiAgICB0aGlzLmZyYWN0aW9uYWxEZWxheVJpZ2h0LnNldERlbGF5KGRlbGF5UmlnaHQpO1xuICB9XG5cbiAgcHJvY2Vzc29yTm9kZUZ1bmN0aW9uKCkge1xuICAgIHZhciB0aGF0ID0gdGhpcztcbiAgICB0aGlzLnByb2Nlc3Nvck5vZGUub25hdWRpb3Byb2Nlc3MgPSBmdW5jdGlvbihlKSB7XG4gICAgICAvLyBHZXQgdGhlIGlucHV0QnVmZmVyXG4gICAgICB2YXIgaW5wdXRBcnJheSA9IGUuaW5wdXRCdWZmZXIuZ2V0Q2hhbm5lbERhdGEoMCk7XG5cbiAgICAgIC8vIEdldCB0aGUgb3V0cHV0QnVmZmVyc1xuICAgICAgdmFyIGxlZnRPdXRwdXRBcnJheSA9IGUub3V0cHV0QnVmZmVyLmdldENoYW5uZWxEYXRhKDApO1xuICAgICAgdmFyIHJpZ2h0T3V0cHV0QXJyYXkgPSBlLm91dHB1dEJ1ZmZlci5nZXRDaGFubmVsRGF0YSgxKTtcblxuICAgICAgLy8gRGVsYXlcbiAgICAgIHZhciBtZWRpdW1BcnJheUxlZnQgPSBuZXcgRmxvYXQzMkFycmF5KHRoYXQuZnJhY3Rpb25hbERlbGF5TGVmdC5wcm9jZXNzKGlucHV0QXJyYXkpKTtcbiAgICAgIHZhciBtZWRpdW1BcnJheVJpZ2h0ID0gbmV3IEZsb2F0MzJBcnJheSh0aGF0LmZyYWN0aW9uYWxEZWxheVJpZ2h0LnByb2Nlc3MoaW5wdXRBcnJheSkpO1xuXG4gICAgICAvLyBCaXF1YWRGaWx0ZXJcbiAgICAgIHRoYXQuYmlxdWFkRmlsdGVyTGVmdC5wcm9jZXNzKG1lZGl1bUFycmF5TGVmdCwgbGVmdE91dHB1dEFycmF5KTtcbiAgICAgIHRoYXQuYmlxdWFkRmlsdGVyUmlnaHQucHJvY2VzcyhtZWRpdW1BcnJheVJpZ2h0LCByaWdodE91dHB1dEFycmF5KTtcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIENvbm5lY3QgdGhlIGNvbnZvbHZlckF1ZGlvR3JhcGggdG8gYSBub2RlXG4gICAqIEBwdWJsaWNcbiAgICogQGNoYWluYWJsZVxuICAgKiBAcGFyYW0gbm9kZSBEZXN0aW5hdGlvbiBub2RlXG4gICAqL1xuICBjb25uZWN0KG5vZGUpIHtcbiAgICB0aGlzLmdhaW5Ob2RlLmNvbm5lY3Qobm9kZSk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogRGlzY29ubmVjdCB0aGUgY29udm9sdmVyQXVkaW9HcmFwaCB0byBhIG5vZGVcbiAgICogQHB1YmxpY1xuICAgKiBAY2hhaW5hYmxlXG4gICAqIEBwYXJhbSBub2RlIERlc3RpbmF0aW9uIG5vZGVcbiAgICovXG4gIGRpc2Nvbm5lY3Qobm9kZSkge1xuICAgIHRoaXMuZ2Fpbk5vZGUuZGlzY29ubmVjdChub2RlKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IEJpbmF1cmFsTW9kZWxlZDtcbiIsIm1vZHVsZS5leHBvcnRzID0geyBcImRlZmF1bHRcIjogcmVxdWlyZShcImNvcmUtanMvbGlicmFyeS9mbi9vYmplY3QvZGVmaW5lLXByb3BlcnR5XCIpLCBfX2VzTW9kdWxlOiB0cnVlIH07IiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbmV4cG9ydHNbXCJkZWZhdWx0XCJdID0gZnVuY3Rpb24gKGluc3RhbmNlLCBDb25zdHJ1Y3Rvcikge1xuICBpZiAoIShpbnN0YW5jZSBpbnN0YW5jZW9mIENvbnN0cnVjdG9yKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJDYW5ub3QgY2FsbCBhIGNsYXNzIGFzIGEgZnVuY3Rpb25cIik7XG4gIH1cbn07XG5cbmV4cG9ydHMuX19lc01vZHVsZSA9IHRydWU7IiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciBfT2JqZWN0JGRlZmluZVByb3BlcnR5ID0gcmVxdWlyZShcImJhYmVsLXJ1bnRpbWUvY29yZS1qcy9vYmplY3QvZGVmaW5lLXByb3BlcnR5XCIpW1wiZGVmYXVsdFwiXTtcblxuZXhwb3J0c1tcImRlZmF1bHRcIl0gPSAoZnVuY3Rpb24gKCkge1xuICBmdW5jdGlvbiBkZWZpbmVQcm9wZXJ0aWVzKHRhcmdldCwgcHJvcHMpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHByb3BzLmxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgZGVzY3JpcHRvciA9IHByb3BzW2ldO1xuICAgICAgZGVzY3JpcHRvci5lbnVtZXJhYmxlID0gZGVzY3JpcHRvci5lbnVtZXJhYmxlIHx8IGZhbHNlO1xuICAgICAgZGVzY3JpcHRvci5jb25maWd1cmFibGUgPSB0cnVlO1xuICAgICAgaWYgKFwidmFsdWVcIiBpbiBkZXNjcmlwdG9yKSBkZXNjcmlwdG9yLndyaXRhYmxlID0gdHJ1ZTtcblxuICAgICAgX09iamVjdCRkZWZpbmVQcm9wZXJ0eSh0YXJnZXQsIGRlc2NyaXB0b3Iua2V5LCBkZXNjcmlwdG9yKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZnVuY3Rpb24gKENvbnN0cnVjdG9yLCBwcm90b1Byb3BzLCBzdGF0aWNQcm9wcykge1xuICAgIGlmIChwcm90b1Byb3BzKSBkZWZpbmVQcm9wZXJ0aWVzKENvbnN0cnVjdG9yLnByb3RvdHlwZSwgcHJvdG9Qcm9wcyk7XG4gICAgaWYgKHN0YXRpY1Byb3BzKSBkZWZpbmVQcm9wZXJ0aWVzKENvbnN0cnVjdG9yLCBzdGF0aWNQcm9wcyk7XG4gICAgcmV0dXJuIENvbnN0cnVjdG9yO1xuICB9O1xufSkoKTtcblxuZXhwb3J0cy5fX2VzTW9kdWxlID0gdHJ1ZTsiLCJ2YXIgJCA9IHJlcXVpcmUoJy4uLy4uL21vZHVsZXMvJCcpO1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBkZWZpbmVQcm9wZXJ0eShpdCwga2V5LCBkZXNjKXtcbiAgcmV0dXJuICQuc2V0RGVzYyhpdCwga2V5LCBkZXNjKTtcbn07IiwidmFyICRPYmplY3QgPSBPYmplY3Q7XG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgY3JlYXRlOiAgICAgJE9iamVjdC5jcmVhdGUsXG4gIGdldFByb3RvOiAgICRPYmplY3QuZ2V0UHJvdG90eXBlT2YsXG4gIGlzRW51bTogICAgIHt9LnByb3BlcnR5SXNFbnVtZXJhYmxlLFxuICBnZXREZXNjOiAgICAkT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcixcbiAgc2V0RGVzYzogICAgJE9iamVjdC5kZWZpbmVQcm9wZXJ0eSxcbiAgc2V0RGVzY3M6ICAgJE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzLFxuICBnZXRLZXlzOiAgICAkT2JqZWN0LmtleXMsXG4gIGdldE5hbWVzOiAgICRPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyxcbiAgZ2V0U3ltYm9sczogJE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMsXG4gIGVhY2g6ICAgICAgIFtdLmZvckVhY2hcbn07IiwiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKipcbiAqIEBmaWxlb3ZlcnZpZXcgQmlxdWFkIEZpbHRlciBsaWJyYXJ5XG4gKiBAYXV0aG9yIEFybmF1Lkp1bGlhQGdtYWlsLmNvbVxuICogQHZlcnNpb24gMC4xLjBcbiAqL1xuXG5cbi8qKlxuICogRnVuY3Rpb24gaW52b2NhdGlvbiBwYXR0ZXJuIGZvciBvYmplY3QgY3JlYXRpb24uXG4gKiBAcHVibGljXG4gKi9cblxuICAvKipcbiAgICogRUNNQVNjcmlwdDUgcHJvcGVydHkgZGVzY3JpcHRvcnMgb2JqZWN0LlxuICAgKi9cblxuICAgY2xhc3MgQmlxdWFkRmlsdGVyICB7XG5cbiAgICBjb25zdHJ1Y3Rvcigpe1xuICAgICAgdGhpcy5jb2VmZmljaWVudHMgPSBbXTtcbiAgICAgIHRoaXMubWVtb3JpZXMgPSBbXTtcbiAgICAgIHRoaXMubnVtYmVyT2ZDYXNjYWRlID0gMTtcbiAgICAgIHRoaXMuY29udGV4dCA9IHVuZGVmaW5lZDtcbiAgICAgIHRoaXMucmVzZXRNZW1vcmllcygpO1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2V0IGJpcXVhZCBmaWx0ZXIgY29lZmZpY2llbnRzXG4gICAgICogQHB1YmxpY1xuICAgICAqIEBwYXJhbSBjb2VmIEFycmF5IG9mIGJpcXVhZCBjb2VmZmljaWVudHMgaW4gdGhlIGZvbGxvd2luZyBvcmRlcjogZ2FpbiwgZmlyc3RCaXF1YWQgYjEsIGZpcnN0QmlxdWFkIGIyLCBmaXJzdEJpcXVhZCBhMSwgZmlyc3RCaXF1YWQgYTIsIHNlY29uZEJpcXVhZCBiMSwgc2Vjb25kQklxdWFkIGIyLCBldGMuXG4gICAgICovXG4gICAgIHNldENvZWZmaWNpZW50cyhjb2VmKSB7XG4gICAgICBpZiAoY29lZikge1xuICAgICAgICAgIC8vIElmIHRoZXJlIGlzIG5vdCBhIG51bWJlciBvZiBiaXF1YWRzLCB3ZSBjb25zaWRlciB0aGF0IHRoZXJlIGlzIG9ubHkgMSBiaXF1YWQuXG4gICAgICAgICAgdGhpcy5udW1iZXJPZkNhc2NhZGUgPSB0aGlzLmdldE51bWJlck9mQ2FzY2FkZUZpbHRlcnMoY29lZik7XG4gICAgICAgICAgLy8gUmVzZXQgY29lZmZpY2llbnRzXG4gICAgICAgICAgdGhpcy5jb2VmZmljaWVudHMgPSBbXTtcbiAgICAgICAgICAvLyBHbG9iYWwgZ2FpblxuICAgICAgICAgIHRoaXMuY29lZmZpY2llbnRzLmcgPSBjb2VmWzBdO1xuICAgICAgICAgIGZvcih2YXIgaSA9IDA7IGkgPCB0aGlzLm51bWJlck9mQ2FzY2FkZSA7IGkgPSBpICsgMSl7XG4gICAgICAgICAgICB0aGlzLmNvZWZmaWNpZW50c1tpXSA9IHt9O1xuICAgICAgICAgICAgLy8gRm91ciBjb2VmZmljaWVudHMgZm9yIGVhY2ggYmlxdWFkXG4gICAgICAgICAgICB0aGlzLmNvZWZmaWNpZW50c1tpXS5iMSA9IGNvZWZbMSArIGkqNF07XG4gICAgICAgICAgICB0aGlzLmNvZWZmaWNpZW50c1tpXS5iMiA9IGNvZWZbMiArIGkqNF07XG4gICAgICAgICAgICB0aGlzLmNvZWZmaWNpZW50c1tpXS5hMSA9IGNvZWZbMyArIGkqNF07XG4gICAgICAgICAgICB0aGlzLmNvZWZmaWNpZW50c1tpXS5hMiA9IGNvZWZbNCArIGkqNF07XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIE5lZWQgdG8gcmVzZXQgdGhlIG1lbW9yaWVzIGFmdGVyIGNoYW5nZSB0aGUgY29lZmZpY2llbnRzXG4gICAgICAgICAgdGhpcy5yZXNldE1lbW9yaWVzKCk7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc29sZS5lcnJvcihcIk5vIGNvZWZmaWNpZW50cyBhcmUgc2V0XCIpO1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIG51bWJlciBvZiBjYXNjYWRlIGZpbHRlcnMgZnJvbSB0aGUgbGlzdCBvZiBjb2VmZmljaWVudHNcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgICBnZXROdW1iZXJPZkNhc2NhZGVGaWx0ZXJzKGNvZWYpIHtcbiAgICAgIHZhciBudW1iZXJPZkNhc2NhZGUgPSAoY29lZi5sZW5ndGggLSAxKS80O1xuICAgICAgcmV0dXJuIG51bWJlck9mQ2FzY2FkZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXNldCBtZW1vcmllcyBvZiBiaXF1YWQgZmlsdGVycy5cbiAgICAgKiBAcHVibGljXG4gICAgICovXG4gICAgIHJlc2V0TWVtb3JpZXMoKSB7XG4gICAgICB0aGlzLm1lbW9yaWVzID0gW107XG4gICAgICB0aGlzLm1lbW9yaWVzWzBdID0ge307XG4gICAgICB0aGlzLm1lbW9yaWVzWzBdLnhpMSA9IDA7XG4gICAgICB0aGlzLm1lbW9yaWVzWzBdLnhpMiA9IDA7XG4gICAgICB0aGlzLm1lbW9yaWVzWzBdLnlpMSA9IDA7XG4gICAgICB0aGlzLm1lbW9yaWVzWzBdLnlpMiA9IDA7XG5cbiAgICAgIGZvcih2YXIgaSA9IDE7IGkgPCB0aGlzLm51bWJlck9mQ2FzY2FkZTsgaSA9IGkgKzEpe1xuICAgICAgICB0aGlzLm1lbW9yaWVzW2ldID0ge307XG4gICAgICAgIHRoaXMubWVtb3JpZXNbaV0ueWkxID0gMDtcbiAgICAgICAgdGhpcy5tZW1vcmllc1tpXS55aTIgPSAwO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENhbGN1bGF0ZSB0aGUgb3V0cHV0IG9mIHRoZSBjYXNjYWRlIG9mIGJpcXVhZCBmaWx0ZXJzIGZvciBhbiBpbnB1dEJ1ZmZlci5cbiAgICAgKiBAcHVibGljXG4gICAgICogQHBhcmFtIGlucHV0QnVmZmVyIEFycmF5IG9mIHRoZSBzYW1lIGxlbmd0aCBvZiBvdXRwdXRCdWZmZXJcbiAgICAgKiBAcGFyYW0gb3V0cHV0QnVmZmVyIEFycmF5IG9mIHRoZSBzYW1lIGxlbmd0aCBvZiBpbnB1dEJ1ZmZlclxuICAgICAqL1xuICAgICBwcm9jZXNzKGlucHV0QnVmZmVyLCBvdXRwdXRCdWZmZXIpIHtcbiAgICAgIHZhciB4O1xuICAgICAgdmFyIHkgPSBbXVxuICAgICAgdmFyIGIxLCBiMiwgYTEsIGEyO1xuICAgICAgdmFyIHhpMSwgeGkyLCB5aTEsIHlpMiwgeTFpMSwgeTFpMjtcblxuICAgICAgZm9yKHZhciBpID0gMDsgaSA8IGlucHV0QnVmZmVyLmxlbmd0aDsgaSA9IGkrMSkge1xuICAgICAgICB4ID0gaW5wdXRCdWZmZXJbaV07XG4gICAgICAgICAgLy8gU2F2ZSBjb2VmZmljaWVudHMgaW4gbG9jYWwgdmFyaWFibGVzXG4gICAgICAgICAgYjEgPSB0aGlzLmNvZWZmaWNpZW50c1swXS5iMTtcbiAgICAgICAgICBiMiA9IHRoaXMuY29lZmZpY2llbnRzWzBdLmIyO1xuICAgICAgICAgIGExID0gdGhpcy5jb2VmZmljaWVudHNbMF0uYTE7XG4gICAgICAgICAgYTIgPSB0aGlzLmNvZWZmaWNpZW50c1swXS5hMjtcbiAgICAgICAgICAvLyBTYXZlIG1lbW9yaWVzIGluIGxvY2FsIHZhcmlhYmxlc1xuICAgICAgICAgIHhpMSA9IHRoaXMubWVtb3JpZXNbMF0ueGkxO1xuICAgICAgICAgIHhpMiA9IHRoaXMubWVtb3JpZXNbMF0ueGkyO1xuICAgICAgICAgIHlpMSA9IHRoaXMubWVtb3JpZXNbMF0ueWkxO1xuICAgICAgICAgIHlpMiA9IHRoaXMubWVtb3JpZXNbMF0ueWkyO1xuXG4gICAgICAgICAgLy8gRm9ybXVsYTogeVtuXSA9IHhbbl0gKyBiMSp4W24tMV0gKyBiMip4W24tMl0gLSBhMSp5W24tMV0gLSBhMip5W24tMl1cbiAgICAgICAgICAvLyBGaXJzdCBiaXF1YWRcbiAgICAgICAgICB5WzBdID0geCArIGIxICogeGkxICsgYjIgKiB4aTIgLSBhMSAqIHlpMSAtIGEyICogeWkyO1xuXG4gICAgICAgICAgZm9yKHZhciBlID0gMTsgZSA8IHRoaXMubnVtYmVyT2ZDYXNjYWRlOyBlID0gZSArIDEpIHtcbiAgICAgICAgICAgIC8vIFNhdmUgY29lZmZpY2llbnRzIGluIGxvY2FsIHZhcmlhYmxlc1xuICAgICAgICAgICAgYjEgPSB0aGlzLmNvZWZmaWNpZW50c1tlXS5iMTtcbiAgICAgICAgICAgIGIyID0gdGhpcy5jb2VmZmljaWVudHNbZV0uYjI7XG4gICAgICAgICAgICBhMSA9IHRoaXMuY29lZmZpY2llbnRzW2VdLmExO1xuICAgICAgICAgICAgYTIgPSB0aGlzLmNvZWZmaWNpZW50c1tlXS5hMjtcbiAgICAgICAgICAgIC8vIFNhdmUgbWVtb3JpZXMgaW4gbG9jYWwgdmFyaWFibGVzXG4gICAgICAgICAgICB5MWkxID0gdGhpcy5tZW1vcmllc1tlIC0gMV0ueWkxO1xuICAgICAgICAgICAgeTFpMiA9IHRoaXMubWVtb3JpZXNbZSAtIDFdLnlpMjtcbiAgICAgICAgICAgIHlpMSA9IHRoaXMubWVtb3JpZXNbZV0ueWkxO1xuICAgICAgICAgICAgeWkyID0gdGhpcy5tZW1vcmllc1tlXS55aTI7XG5cbiAgICAgICAgICAgIHlbZV0gPSB5W2UgLSAxXSArIGIxICogeTFpMSArIGIyICogeTFpMiAtIGExICogeWkxIC0gYTIgKiB5aTI7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gV3JpdGUgdGhlIG91dHB1dFxuICAgICAgICAgIG91dHB1dEJ1ZmZlcltpXSA9IHlbdGhpcy5udW1iZXJPZkNhc2NhZGUgLSAxXSAqIHRoaXMuY29lZmZpY2llbnRzLmc7XG5cbiAgICAgICAgICAvLyBVcGRhdGUgdGhlIG1lbW9yaWVzXG4gICAgICAgICAgdGhpcy5tZW1vcmllc1swXS54aTIgPSB0aGlzLm1lbW9yaWVzWzBdLnhpMTtcbiAgICAgICAgICB0aGlzLm1lbW9yaWVzWzBdLnhpMSA9IHg7XG5cbiAgICAgICAgICBmb3IodmFyIHAgPSAwOyBwIDwgdGhpcy5udW1iZXJPZkNhc2NhZGU7IHAgPSBwICsxKXtcbiAgICAgICAgICAgIHRoaXMubWVtb3JpZXNbcF0ueWkyID0gdGhpcy5tZW1vcmllc1twXS55aTE7XG4gICAgICAgICAgICB0aGlzLm1lbW9yaWVzW3BdLnlpMSA9IHlbcF07XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICB9O1xuXG5cbi8vIC8vIENvbW1vbkpTIGZ1bmN0aW9uIGV4cG9ydFxubW9kdWxlLmV4cG9ydHMgPSBCaXF1YWRGaWx0ZXI7XG4iLCIvKipcbiAqIEBmaWxlb3ZlcnZpZXcgRnJhY3Rpb25hbCBkZWxheSBsaWJyYXJ5XG4gKiBAYXV0aG9yIEFybmF1IEp1bGnDoCA8QXJuYXUuSnVsaWFAZ21haWwuY29tPlxuICogQHZlcnNpb24gMC4xLjBcbiAqL1xuLyoqXG4gKiBAY2xhc3MgRnJhY3Rpb25hbERlbGF5XG4gKiBAcHVibGljXG4gKi9cbmNsYXNzIEZyYWN0aW9uYWxEZWxheSB7XG5cbiAgICAvKipcbiAgICAgKiBNYW5kYXRvcnkgaW5pdGlhbGl6YXRpb24gbWV0aG9kLlxuICAgICAqIEBwdWJsaWNcbiAgICAgKiBAcGFyYW0gdW5pdHM6SHogc2FtcGxlUmF0ZSBTYW1wbGUgUmF0ZSB0aGUgYXBwYXJhdHVzIG9wZXJhdGVzIG9uLlxuICAgICAqIEBwYXJhbSB0eXBlOkZsb2F0IHVuaXRzOnMgbWluOjAuMCBkZWZhdWx0OjEgb3B0TWF4RGVsYXlUaW1lIFRoZSBtYXhpbXVtIGRlbGF5IHRpbWUuXG4gICAgICogQGNoYWluYWJsZVxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHNhbXBsZVJhdGUsIG9wdE1heERlbGF5VGltZSkge1xuICAgICAgICAvLyBQcm9wZXJ0aWVzIHdpdGggZGVmYXVsdCB2YWx1ZXNcbiAgICAgICAgdGhpcy5kZWxheVRpbWUgPSAwO1xuICAgICAgICB0aGlzLnBvc1JlYWQgPSAwO1xuICAgICAgICB0aGlzLnBvc1dyaXRlID0gMDtcbiAgICAgICAgdGhpcy5mcmFjWGkxID0gMDtcbiAgICAgICAgdGhpcy5mcmFjWWkxID0gMDtcbiAgICAgICAgdGhpcy5pbnREZWxheSA9IDA7XG4gICAgICAgIHRoaXMuZnJhY0RlbGF5ID0gMDtcblxuICAgICAgICAvLyBPdGhlciBwcm9wZXJ0aWVzXG4gICAgICAgIHRoaXMuYTEgPSB1bmRlZmluZWQ7XG5cbiAgICAgICAgLy8gU2F2ZSBzYW1wbGUgcmF0ZVxuICAgICAgICB0aGlzLnNhbXBsZVJhdGUgPSBzYW1wbGVSYXRlO1xuICAgICAgICB0aGlzLm1heERlbGF5VGltZSA9IG9wdE1heERlbGF5VGltZSB8fCAxO1xuXG4gICAgICAgIHRoaXMuYnVmZmVyU2l6ZSA9IHRoaXMubWF4RGVsYXlUaW1lICogdGhpcy5zYW1wbGVSYXRlO1xuICAgICAgICAvLyBDaGVjayBpZiB0aGUgYnVmZmVyU2l6ZSBpcyBub3QgYW4gaW50ZWdlclxuICAgICAgICBpZiAodGhpcy5idWZmZXJTaXplICUgMSAhPT0gMCkge1xuICAgICAgICAgICAgdGhpcy5idWZmZXJTaXplID0gcGFyc2VJbnQodGhpcy5idWZmZXJTaXplKSArIDE7XG4gICAgICAgIH1cbiAgICAgICAgLy8gQ3JlYXRlIHRoZSBpbnRlcm5hbCBidWZmZXJcbiAgICAgICAgdGhpcy5idWZmZXIgPSBuZXcgRmxvYXQzMkFycmF5KHRoaXMuYnVmZmVyU2l6ZSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2V0IGRlbGF5IHZhbHVlXG4gICAgICogQHBhcmFtIGRlbGF5VGltZSBEZWxheSB0aW1lXG4gICAgICogQHB1YmxpY1xuICAgICAqL1xuICAgIHNldERlbGF5KGRlbGF5VGltZSkge1xuICAgICAgICBpZiAoZGVsYXlUaW1lIDwgdGhpcy5tYXhEZWxheVRpbWUpIHtcbiAgICAgICAgICAgIC8vIFNhdmUgZGVsYXkgdmFsdWVcbiAgICAgICAgICAgIHRoaXMuZGVsYXlUaW1lID0gZGVsYXlUaW1lO1xuICAgICAgICAgICAgLy8gVHJhbnNmb3JtIHRpbWUgaW4gc2FtcGxlc1xuICAgICAgICAgICAgdmFyIHNhbXBsZXNEZWxheSA9IGRlbGF5VGltZSAqIHRoaXMuc2FtcGxlUmF0ZTtcbiAgICAgICAgICAgIC8vIEdldCB0aGUgaW50ZWdlciBwYXJ0IG9mIHNhbXBsZXNEZWxheVxuICAgICAgICAgICAgdGhpcy5pbnREZWxheSA9IHBhcnNlSW50KHNhbXBsZXNEZWxheSk7XG4gICAgICAgICAgICAvLyBHZXQgdGhlIGZyYWN0aW9uYWwgcGFydCBvZiBzYW1wbGVzRGVsYXlcbiAgICAgICAgICAgIHRoaXMuZnJhY0RlbGF5ID0gc2FtcGxlc0RlbGF5IC0gdGhpcy5pbnREZWxheTtcbiAgICAgICAgICAgIC8vIFVwZGF0ZSB0aGUgdmFsdWUgb2YgdGhlIHBvaW50ZXJcbiAgICAgICAgICAgIHRoaXMucmVzYW1wbGUoKTtcbiAgICAgICAgICAgIC8vIElmIHRoZSBkZWxheSBoYXMgZnJhY3Rpb25hbCBwYXJ0LCB1cGRhdGUgdGhlIFRoaXJhbiBDb2VmZmljaWVudHNcbiAgICAgICAgICAgIGlmICh0aGlzLmZyYWNEZWxheSAhPT0gMCkge1xuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlVGhpcmFuQ29lZmZpY2llbnQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImRlbGF5VGltZSA+IG1heERlbGF5VGltZVwiKTtcbiAgICAgICAgfVxuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogVXBkYXRlIGRlbGF5IHZhbHVlXG4gICAgICogQHB1YmxpY1xuICAgICAqL1xuICAgIGdldERlbGF5KCkge1xuICAgICAgICByZXR1cm4gdGhpcy5kZWxheVRpbWU7XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBQcm9jZXNzIG1ldGhvZCwgd2hlcmUgdGhlIG91dHB1dCBpcyBjYWxjdWxhdGVkLlxuICAgICAqIEBwYXJhbSBpbnB1dEJ1ZmZlciBJbnB1dCBBcnJheVxuICAgICAqIEBwdWJsaWNcbiAgICAgKi9cbiAgICBwcm9jZXNzKGlucHV0QnVmZmVyKSB7XG4gICAgICAgIC8vIENyZWF0ZXMgdGhlIG91dHB1dEJ1ZmZlciwgd2l0aCB0aGUgc2FtZSBsZW5ndGggb2YgdGhlIGlucHV0XG4gICAgICAgIHZhciBvdXRwdXRCdWZmZXIgPSBuZXcgRmxvYXQzMkFycmF5KGlucHV0QnVmZmVyLmxlbmd0aCk7XG5cbiAgICAgICAgLy8gSW50ZWdlciBkZWxheSBwcm9jZXNzIHNlY3Rpb25cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBpbnB1dEJ1ZmZlci5sZW5ndGg7IGkgPSBpICsgMSkge1xuICAgICAgICAgICAgLy8gU2F2ZSB0aGUgaW5wdXQgdmFsdWUgaW4gdGhlIGJ1ZmZlclxuICAgICAgICAgICAgdGhpcy5idWZmZXJbdGhpcy5wb3NXcml0ZV0gPSBpbnB1dEJ1ZmZlcltpXTtcbiAgICAgICAgICAgIC8vIFdyaXRlIHRoZSBvdXRwdXRCdWZmZXIgd2l0aCB0aGUgW2lucHV0VmFsdWUgLSBkZWxheV0gc2FtcGxlXG4gICAgICAgICAgICBvdXRwdXRCdWZmZXJbaV0gPSB0aGlzLmJ1ZmZlclt0aGlzLnBvc1JlYWRdO1xuICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSB2YWx1ZSBvZiBwb3NSZWFkIGFuZCBwb3NXcml0ZSBwb2ludGVyc1xuICAgICAgICAgICAgdGhpcy51cGRhdGVQb2ludGVycygpO1xuICAgICAgICB9XG4gICAgICAgIC8vIE5vIGZyYWN0aW9uYWwgZGVsYXlcbiAgICAgICAgaWYgKHRoaXMuZnJhY0RlbGF5ID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm4gb3V0cHV0QnVmZmVyO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gVGhlIGZyYWN0aW9uYWwgZGVsYXkgcHJvY2VzcyBzZWN0aW9uXG4gICAgICAgICAgICBvdXRwdXRCdWZmZXIgPSBuZXcgRmxvYXQzMkFycmF5KHRoaXMuZnJhY3Rpb25hbFRoaXJhblByb2Nlc3Mob3V0cHV0QnVmZmVyKSk7XG4gICAgICAgICAgICByZXR1cm4gb3V0cHV0QnVmZmVyO1xuICAgICAgICB9XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBVcGRhdGUgdGhlIHZhbHVlIG9mIHBvc1JlYWQgYW5kIHBvc1dyaXRlIHBvaW50ZXJzIGluc2lkZSB0aGUgY2lyY3VsYXIgYnVmZmVyXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICB1cGRhdGVQb2ludGVycygpIHtcbiAgICAgICAgLy8gSXQncyBhIGNpcmN1bGFyIGJ1ZmZlciwgc28sIHdoZW4gaXQgaXMgYXQgdGhlIGxhc3QgcG9zaXRpb24sIHRoZSBwb2ludGVyIHJldHVybiB0byB0aGUgZmlyc3QgcG9zaXRpb25cblxuICAgICAgICAvLyBVcGRhdGUgcG9zV3JpdGUgcG9pbnRlclxuICAgICAgICBpZiAodGhpcy5wb3NXcml0ZSA9PT0gKHRoaXMuYnVmZmVyLmxlbmd0aCAtIDEpKSB7XG4gICAgICAgICAgICB0aGlzLnBvc1dyaXRlID0gMDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMucG9zV3JpdGUgPSB0aGlzLnBvc1dyaXRlICsgMTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFVwZGF0ZSBwb3NSZWFkIHBvaW50ZXJcbiAgICAgICAgaWYgKHRoaXMucG9zUmVhZCA9PT0gKHRoaXMuYnVmZmVyLmxlbmd0aCAtIDEpKSB7XG4gICAgICAgICAgICB0aGlzLnBvc1JlYWQgPSAwO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5wb3NSZWFkID0gdGhpcy5wb3NSZWFkICsgMTtcbiAgICAgICAgfVxuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogVXBkYXRlIFRoaXJhbiBjb2VmZmljaWVudCAoMXN0IG9yZGVyIFRoaXJhbilcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHVwZGF0ZVRoaXJhbkNvZWZmaWNpZW50KCkge1xuICAgICAgICAvLyBVcGRhdGUgdGhlIGNvZWZmaWNpZW50OiAoMS1EKS8oMStEKSB3aGVyZSBEIGlzIGZyYWN0aW9uYWwgZGVsYXlcbiAgICAgICAgdGhpcy5hMSA9ICgxIC0gdGhpcy5mcmFjRGVsYXkpIC8gKDEgKyB0aGlzLmZyYWNEZWxheSk7XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBVcGRhdGUgdGhlIHBvaW50ZXIgcG9zUmVhZCB2YWx1ZSB3aGVuIHRoZSBkZWxheSB2YWx1ZSBpcyBjaGFuZ2VkXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICByZXNhbXBsZSgpIHtcbiAgICAgICAgaWYgKHRoaXMucG9zV3JpdGUgLSB0aGlzLmludERlbGF5IDwgMCkge1xuICAgICAgICAgICAgdmFyIHBvcyA9IHRoaXMuaW50RGVsYXkgLSB0aGlzLnBvc1dyaXRlO1xuICAgICAgICAgICAgdGhpcy5wb3NSZWFkID0gdGhpcy5idWZmZXIubGVuZ3RoIC0gcG9zO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5wb3NSZWFkID0gdGhpcy5wb3NXcml0ZSAtIHRoaXMuaW50RGVsYXk7XG4gICAgICAgIH1cbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIEZyYWN0aW9uYWwgcHJvY2VzcyBtZXRob2QuXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAcGFyYW0gaW5wdXRCdWZmZXIgSW5wdXQgQXJyYXlcbiAgICAgKi9cbiAgICBmcmFjdGlvbmFsVGhpcmFuUHJvY2VzcyhpbnB1dEJ1ZmZlcikge1xuICAgICAgICB2YXIgb3V0cHV0QnVmZmVyID0gbmV3IEZsb2F0MzJBcnJheShpbnB1dEJ1ZmZlci5sZW5ndGgpO1xuXG4gICAgICAgIHZhciB4LCB5O1xuICAgICAgICB2YXIgeGkxID0gdGhpcy5mcmFjWGkxO1xuICAgICAgICB2YXIgeWkxID0gdGhpcy5mcmFjWWkxO1xuXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgaW5wdXRCdWZmZXIubGVuZ3RoOyBpID0gaSArIDEpIHtcbiAgICAgICAgICAgIC8vIEN1cnJlbnQgaW5wdXQgc2FtcGxlXG4gICAgICAgICAgICB4ID0gaW5wdXRCdWZmZXJbaV07XG5cbiAgICAgICAgICAgIC8vIENhbGN1bGF0ZSB0aGUgb3V0cHV0XG4gICAgICAgICAgICB5ID0gdGhpcy5hMSAqIHggKyB4aTEgLSB0aGlzLmExICogeWkxO1xuXG4gICAgICAgICAgICAvLyBVcGRhdGUgdGhlIG1lbW9yaWVzXG4gICAgICAgICAgICB4aTEgPSB4O1xuICAgICAgICAgICAgeWkxID0geTtcbiAgICAgICAgICAgIC8vIFNhdmUgdGhlIG91dHB1dEJ1ZmZlclxuICAgICAgICAgICAgb3V0cHV0QnVmZmVyW2ldID0geTtcblxuICAgICAgICB9XG4gICAgICAgIC8vIFNhdmUgbWVtb3JpZXNcbiAgICAgICAgdGhpcy5mcmFjWGkxID0geGkxO1xuICAgICAgICB0aGlzLmZyYWNZaTEgPSB5aTE7XG5cbiAgICAgICAgcmV0dXJuIG91dHB1dEJ1ZmZlcjtcbiAgICB9XG5cbn07IC8vIEVuZCBvZiBvYmplY3QgZGVmaW5pdGlvbi5cblxuXG5tb2R1bGUuZXhwb3J0cyA9IEZyYWN0aW9uYWxEZWxheTtcbiIsIi8qKlxuICogQVVUSE9SIE9GIElOSVRJQUwgSlMgTElCUkFSWVxuICogay1kIFRyZWUgSmF2YVNjcmlwdCAtIFYgMS4wXG4gKlxuICogaHR0cHM6Ly9naXRodWIuY29tL3ViaWxhYnMva2QtdHJlZS1qYXZhc2NyaXB0XG4gKlxuICogQGF1dGhvciBNaXJjZWEgUHJpY29wIDxwcmljb3BAdWJpbGFicy5uZXQ+LCAyMDEyXG4gKiBAYXV0aG9yIE1hcnRpbiBLbGVwcGUgPGtsZXBwZUB1YmlsYWJzLm5ldD4sIDIwMTJcbiAqIEBhdXRob3IgVWJpbGFicyBodHRwOi8vdWJpbGFicy5uZXQsIDIwMTJcbiAqIEBsaWNlbnNlIE1JVCBMaWNlbnNlIDxodHRwOi8vd3d3Lm9wZW5zb3VyY2Uub3JnL2xpY2Vuc2VzL21pdC1saWNlbnNlLnBocD5cbiAqL1xuXG5cbmZ1bmN0aW9uIE5vZGUob2JqLCBkaW1lbnNpb24sIHBhcmVudCkge1xuICB0aGlzLm9iaiA9IG9iajtcbiAgdGhpcy5sZWZ0ID0gbnVsbDtcbiAgdGhpcy5yaWdodCA9IG51bGw7XG4gIHRoaXMucGFyZW50ID0gcGFyZW50O1xuICB0aGlzLmRpbWVuc2lvbiA9IGRpbWVuc2lvbjtcbn1cblxuZnVuY3Rpb24gS2RUcmVlKHBvaW50cywgbWV0cmljLCBkaW1lbnNpb25zKSB7XG5cbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBcbiAgZnVuY3Rpb24gYnVpbGRUcmVlKHBvaW50cywgZGVwdGgsIHBhcmVudCkge1xuICAgIHZhciBkaW0gPSBkZXB0aCAlIGRpbWVuc2lvbnMubGVuZ3RoLFxuICAgICAgbWVkaWFuLFxuICAgICAgbm9kZTtcblxuICAgIGlmIChwb2ludHMubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKHBvaW50cy5sZW5ndGggPT09IDEpIHtcbiAgICAgIHJldHVybiBuZXcgTm9kZShwb2ludHNbMF0sIGRpbSwgcGFyZW50KTtcbiAgICB9XG5cbiAgICBwb2ludHMuc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgICAgcmV0dXJuIGFbZGltZW5zaW9uc1tkaW1dXSAtIGJbZGltZW5zaW9uc1tkaW1dXTtcbiAgICB9KTtcblxuICAgIG1lZGlhbiA9IE1hdGguZmxvb3IocG9pbnRzLmxlbmd0aCAvIDIpO1xuICAgIG5vZGUgPSBuZXcgTm9kZShwb2ludHNbbWVkaWFuXSwgZGltLCBwYXJlbnQpO1xuICAgIG5vZGUubGVmdCA9IGJ1aWxkVHJlZShwb2ludHMuc2xpY2UoMCwgbWVkaWFuKSwgZGVwdGggKyAxLCBub2RlKTtcbiAgICBub2RlLnJpZ2h0ID0gYnVpbGRUcmVlKHBvaW50cy5zbGljZShtZWRpYW4gKyAxKSwgZGVwdGggKyAxLCBub2RlKTtcblxuICAgIHJldHVybiBub2RlO1xuICB9XG5cbiAgdGhpcy5yb290ID0gYnVpbGRUcmVlKHBvaW50cywgMCwgbnVsbCk7XG5cbiAgdGhpcy5pbnNlcnQgPSBmdW5jdGlvbiAocG9pbnQpIHtcbiAgICBmdW5jdGlvbiBpbm5lclNlYXJjaChub2RlLCBwYXJlbnQpIHtcblxuICAgICAgaWYgKG5vZGUgPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIHBhcmVudDtcbiAgICAgIH1cblxuICAgICAgdmFyIGRpbWVuc2lvbiA9IGRpbWVuc2lvbnNbbm9kZS5kaW1lbnNpb25dO1xuICAgICAgaWYgKHBvaW50W2RpbWVuc2lvbl0gPCBub2RlLm9ialtkaW1lbnNpb25dKSB7XG4gICAgICAgIHJldHVybiBpbm5lclNlYXJjaChub2RlLmxlZnQsIG5vZGUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIGlubmVyU2VhcmNoKG5vZGUucmlnaHQsIG5vZGUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHZhciBpbnNlcnRQb3NpdGlvbiA9IGlubmVyU2VhcmNoKHRoaXMucm9vdCwgbnVsbCksXG4gICAgICBuZXdOb2RlLFxuICAgICAgZGltZW5zaW9uO1xuXG4gICAgaWYgKGluc2VydFBvc2l0aW9uID09PSBudWxsKSB7XG4gICAgICB0aGlzLnJvb3QgPSBuZXcgTm9kZShwb2ludCwgMCwgbnVsbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbmV3Tm9kZSA9IG5ldyBOb2RlKHBvaW50LCAoaW5zZXJ0UG9zaXRpb24uZGltZW5zaW9uICsgMSkgJSBkaW1lbnNpb25zLmxlbmd0aCwgaW5zZXJ0UG9zaXRpb24pO1xuICAgIGRpbWVuc2lvbiA9IGRpbWVuc2lvbnNbaW5zZXJ0UG9zaXRpb24uZGltZW5zaW9uXTtcblxuICAgIGlmIChwb2ludFtkaW1lbnNpb25dIDwgaW5zZXJ0UG9zaXRpb24ub2JqW2RpbWVuc2lvbl0pIHtcbiAgICAgIGluc2VydFBvc2l0aW9uLmxlZnQgPSBuZXdOb2RlO1xuICAgIH0gZWxzZSB7XG4gICAgICBpbnNlcnRQb3NpdGlvbi5yaWdodCA9IG5ld05vZGU7XG4gICAgfVxuICB9O1xuXG4gIHRoaXMucmVtb3ZlID0gZnVuY3Rpb24gKHBvaW50KSB7XG4gICAgdmFyIG5vZGU7XG5cbiAgICBmdW5jdGlvbiBub2RlU2VhcmNoKG5vZGUpIHtcbiAgICAgIGlmIChub2RlID09PSBudWxsKSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuXG4gICAgICBpZiAobm9kZS5vYmogPT09IHBvaW50KSB7XG4gICAgICAgIHJldHVybiBub2RlO1xuICAgICAgfVxuXG4gICAgICB2YXIgZGltZW5zaW9uID0gZGltZW5zaW9uc1tub2RlLmRpbWVuc2lvbl07XG5cbiAgICAgIGlmIChwb2ludFtkaW1lbnNpb25dIDwgbm9kZS5vYmpbZGltZW5zaW9uXSkge1xuICAgICAgICByZXR1cm4gbm9kZVNlYXJjaChub2RlLmxlZnQsIG5vZGUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIG5vZGVTZWFyY2gobm9kZS5yaWdodCwgbm9kZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVtb3ZlTm9kZShub2RlKSB7XG4gICAgICB2YXIgbmV4dE5vZGUsXG4gICAgICAgIG5leHRPYmosXG4gICAgICAgIHBEaW1lbnNpb247XG5cbiAgICAgIGZ1bmN0aW9uIGZpbmRNYXgobm9kZSwgZGltKSB7XG4gICAgICAgIHZhciBkaW1lbnNpb24sXG4gICAgICAgICAgb3duLFxuICAgICAgICAgIGxlZnQsXG4gICAgICAgICAgcmlnaHQsXG4gICAgICAgICAgbWF4O1xuXG4gICAgICAgIGlmIChub2RlID09PSBudWxsKSB7XG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBkaW1lbnNpb24gPSBkaW1lbnNpb25zW2RpbV07XG4gICAgICAgIGlmIChub2RlLmRpbWVuc2lvbiA9PT0gZGltKSB7XG4gICAgICAgICAgaWYgKG5vZGUucmlnaHQgIT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybiBmaW5kTWF4KG5vZGUucmlnaHQsIGRpbSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBub2RlO1xuICAgICAgICB9XG5cbiAgICAgICAgb3duID0gbm9kZS5vYmpbZGltZW5zaW9uXTtcbiAgICAgICAgbGVmdCA9IGZpbmRNYXgobm9kZS5sZWZ0LCBkaW0pO1xuICAgICAgICByaWdodCA9IGZpbmRNYXgobm9kZS5yaWdodCwgZGltKTtcbiAgICAgICAgbWF4ID0gbm9kZTtcblxuICAgICAgICBpZiAobGVmdCAhPT0gbnVsbCAmJiBsZWZ0Lm9ialtkaW1lbnNpb25dID4gb3duKSB7XG4gICAgICAgICAgbWF4ID0gbGVmdDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChyaWdodCAhPT0gbnVsbCAmJiByaWdodC5vYmpbZGltZW5zaW9uXSA+IG1heC5vYmpbZGltZW5zaW9uXSkge1xuICAgICAgICAgIG1heCA9IHJpZ2h0O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBtYXg7XG4gICAgICB9XG5cbiAgICAgIGZ1bmN0aW9uIGZpbmRNaW4obm9kZSwgZGltKSB7XG4gICAgICAgIHZhciBkaW1lbnNpb24sXG4gICAgICAgICAgb3duLFxuICAgICAgICAgIGxlZnQsXG4gICAgICAgICAgcmlnaHQsXG4gICAgICAgICAgbWluO1xuXG4gICAgICAgIGlmIChub2RlID09PSBudWxsKSB7XG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBkaW1lbnNpb24gPSBkaW1lbnNpb25zW2RpbV07XG5cbiAgICAgICAgaWYgKG5vZGUuZGltZW5zaW9uID09PSBkaW0pIHtcbiAgICAgICAgICBpZiAobm9kZS5sZWZ0ICE9PSBudWxsKSB7XG4gICAgICAgICAgICByZXR1cm4gZmluZE1pbihub2RlLmxlZnQsIGRpbSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBub2RlO1xuICAgICAgICB9XG5cbiAgICAgICAgb3duID0gbm9kZS5vYmpbZGltZW5zaW9uXTtcbiAgICAgICAgbGVmdCA9IGZpbmRNaW4obm9kZS5sZWZ0LCBkaW0pO1xuICAgICAgICByaWdodCA9IGZpbmRNaW4obm9kZS5yaWdodCwgZGltKTtcbiAgICAgICAgbWluID0gbm9kZTtcblxuICAgICAgICBpZiAobGVmdCAhPT0gbnVsbCAmJiBsZWZ0Lm9ialtkaW1lbnNpb25dIDwgb3duKSB7XG4gICAgICAgICAgbWluID0gbGVmdDtcbiAgICAgICAgfVxuICAgICAgICBpZiAocmlnaHQgIT09IG51bGwgJiYgcmlnaHQub2JqW2RpbWVuc2lvbl0gPCBtaW4ub2JqW2RpbWVuc2lvbl0pIHtcbiAgICAgICAgICBtaW4gPSByaWdodDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbWluO1xuICAgICAgfVxuXG4gICAgICBpZiAobm9kZS5sZWZ0ID09PSBudWxsICYmIG5vZGUucmlnaHQgPT09IG51bGwpIHtcbiAgICAgICAgaWYgKG5vZGUucGFyZW50ID09PSBudWxsKSB7XG4gICAgICAgICAgc2VsZi5yb290ID0gbnVsbDtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBwRGltZW5zaW9uID0gZGltZW5zaW9uc1tub2RlLnBhcmVudC5kaW1lbnNpb25dO1xuXG4gICAgICAgIGlmIChub2RlLm9ialtwRGltZW5zaW9uXSA8IG5vZGUucGFyZW50Lm9ialtwRGltZW5zaW9uXSkge1xuICAgICAgICAgIG5vZGUucGFyZW50LmxlZnQgPSBudWxsO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG5vZGUucGFyZW50LnJpZ2h0ID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChub2RlLmxlZnQgIT09IG51bGwpIHtcbiAgICAgICAgbmV4dE5vZGUgPSBmaW5kTWF4KG5vZGUubGVmdCwgbm9kZS5kaW1lbnNpb24pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbmV4dE5vZGUgPSBmaW5kTWluKG5vZGUucmlnaHQsIG5vZGUuZGltZW5zaW9uKTtcbiAgICAgIH1cblxuICAgICAgbmV4dE9iaiA9IG5leHROb2RlLm9iajtcbiAgICAgIHJlbW92ZU5vZGUobmV4dE5vZGUpO1xuICAgICAgbm9kZS5vYmogPSBuZXh0T2JqO1xuXG4gICAgfVxuXG4gICAgbm9kZSA9IG5vZGVTZWFyY2goc2VsZi5yb290KTtcblxuICAgIGlmIChub2RlID09PSBudWxsKSB7IHJldHVybjsgfVxuXG4gICAgcmVtb3ZlTm9kZShub2RlKTtcbiAgfTtcblxuICB0aGlzLm5lYXJlc3QgPSBmdW5jdGlvbiAocG9pbnQsIG1heE5vZGVzLCBtYXhEaXN0YW5jZSkge1xuICAgIHZhciBpLFxuICAgICAgcmVzdWx0LFxuICAgICAgYmVzdE5vZGVzO1xuXG4gICAgYmVzdE5vZGVzID0gbmV3IEJpbmFyeUhlYXAoXG4gICAgICBmdW5jdGlvbiAoZSkgeyByZXR1cm4gLWVbMV07IH1cbiAgICApO1xuXG4gICAgZnVuY3Rpb24gbmVhcmVzdFNlYXJjaChub2RlKSB7XG4gICAgICB2YXIgYmVzdENoaWxkLFxuICAgICAgICBkaW1lbnNpb24gPSBkaW1lbnNpb25zW25vZGUuZGltZW5zaW9uXSxcbiAgICAgICAgb3duRGlzdGFuY2UgPSBtZXRyaWMocG9pbnQsIG5vZGUub2JqKSxcbiAgICAgICAgbGluZWFyUG9pbnQgPSB7fSxcbiAgICAgICAgbGluZWFyRGlzdGFuY2UsXG4gICAgICAgIG90aGVyQ2hpbGQsXG4gICAgICAgIGk7XG5cbiAgICAgIGZ1bmN0aW9uIHNhdmVOb2RlKG5vZGUsIGRpc3RhbmNlKSB7XG4gICAgICAgIGJlc3ROb2Rlcy5wdXNoKFtub2RlLCBkaXN0YW5jZV0pO1xuICAgICAgICBpZiAoYmVzdE5vZGVzLnNpemUoKSA+IG1heE5vZGVzKSB7XG4gICAgICAgICAgYmVzdE5vZGVzLnBvcCgpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZvciAoaSA9IDA7IGkgPCBkaW1lbnNpb25zLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIGlmIChpID09PSBub2RlLmRpbWVuc2lvbikge1xuICAgICAgICAgIGxpbmVhclBvaW50W2RpbWVuc2lvbnNbaV1dID0gcG9pbnRbZGltZW5zaW9uc1tpXV07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbGluZWFyUG9pbnRbZGltZW5zaW9uc1tpXV0gPSBub2RlLm9ialtkaW1lbnNpb25zW2ldXTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBsaW5lYXJEaXN0YW5jZSA9IG1ldHJpYyhsaW5lYXJQb2ludCwgbm9kZS5vYmopO1xuXG4gICAgICBpZiAobm9kZS5yaWdodCA9PT0gbnVsbCAmJiBub2RlLmxlZnQgPT09IG51bGwpIHtcbiAgICAgICAgaWYgKGJlc3ROb2Rlcy5zaXplKCkgPCBtYXhOb2RlcyB8fCBvd25EaXN0YW5jZSA8IGJlc3ROb2Rlcy5wZWVrKClbMV0pIHtcbiAgICAgICAgICBzYXZlTm9kZShub2RlLCBvd25EaXN0YW5jZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAobm9kZS5yaWdodCA9PT0gbnVsbCkge1xuICAgICAgICBiZXN0Q2hpbGQgPSBub2RlLmxlZnQ7XG4gICAgICB9IGVsc2UgaWYgKG5vZGUubGVmdCA9PT0gbnVsbCkge1xuICAgICAgICBiZXN0Q2hpbGQgPSBub2RlLnJpZ2h0O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHBvaW50W2RpbWVuc2lvbl0gPCBub2RlLm9ialtkaW1lbnNpb25dKSB7XG4gICAgICAgICAgYmVzdENoaWxkID0gbm9kZS5sZWZ0O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGJlc3RDaGlsZCA9IG5vZGUucmlnaHQ7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgbmVhcmVzdFNlYXJjaChiZXN0Q2hpbGQpO1xuXG4gICAgICBpZiAoYmVzdE5vZGVzLnNpemUoKSA8IG1heE5vZGVzIHx8IG93bkRpc3RhbmNlIDwgYmVzdE5vZGVzLnBlZWsoKVsxXSkge1xuICAgICAgICBzYXZlTm9kZShub2RlLCBvd25EaXN0YW5jZSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChiZXN0Tm9kZXMuc2l6ZSgpIDwgbWF4Tm9kZXMgfHwgTWF0aC5hYnMobGluZWFyRGlzdGFuY2UpIDwgYmVzdE5vZGVzLnBlZWsoKVsxXSkge1xuICAgICAgICBpZiAoYmVzdENoaWxkID09PSBub2RlLmxlZnQpIHtcbiAgICAgICAgICBvdGhlckNoaWxkID0gbm9kZS5yaWdodDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBvdGhlckNoaWxkID0gbm9kZS5sZWZ0O1xuICAgICAgICB9XG4gICAgICAgIGlmIChvdGhlckNoaWxkICE9PSBudWxsKSB7XG4gICAgICAgICAgbmVhcmVzdFNlYXJjaChvdGhlckNoaWxkKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChtYXhEaXN0YW5jZSkge1xuICAgICAgZm9yIChpID0gMDsgaSA8IG1heE5vZGVzOyBpICs9IDEpIHtcbiAgICAgICAgYmVzdE5vZGVzLnB1c2goW251bGwsIG1heERpc3RhbmNlXSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgbmVhcmVzdFNlYXJjaChzZWxmLnJvb3QpO1xuXG4gICAgcmVzdWx0ID0gW107XG5cbiAgICBmb3IgKGkgPSAwOyBpIDwgbWF4Tm9kZXM7IGkgKz0gMSkge1xuICAgICAgaWYgKGJlc3ROb2Rlcy5jb250ZW50W2ldWzBdKSB7XG4gICAgICAgIHJlc3VsdC5wdXNoKFtiZXN0Tm9kZXMuY29udGVudFtpXVswXS5vYmosIGJlc3ROb2Rlcy5jb250ZW50W2ldWzFdXSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgdGhpcy5iYWxhbmNlRmFjdG9yID0gZnVuY3Rpb24gKCkge1xuICAgIGZ1bmN0aW9uIGhlaWdodChub2RlKSB7XG4gICAgICBpZiAobm9kZSA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gMDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBNYXRoLm1heChoZWlnaHQobm9kZS5sZWZ0KSwgaGVpZ2h0KG5vZGUucmlnaHQpKSArIDE7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY291bnQobm9kZSkge1xuICAgICAgaWYgKG5vZGUgPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgICB9XG4gICAgICByZXR1cm4gY291bnQobm9kZS5sZWZ0KSArIGNvdW50KG5vZGUucmlnaHQpICsgMTtcbiAgICB9XG5cbiAgICByZXR1cm4gaGVpZ2h0KHNlbGYucm9vdCkgLyAoTWF0aC5sb2coY291bnQoc2VsZi5yb290KSkgLyBNYXRoLmxvZygyKSk7XG4gIH07XG59XG5cbi8vIEJpbmFyeSBoZWFwIGltcGxlbWVudGF0aW9uIGZyb206XG4vLyBodHRwOi8vZWxvcXVlbnRqYXZhc2NyaXB0Lm5ldC9hcHBlbmRpeDIuaHRtbFxuXG5mdW5jdGlvbiBCaW5hcnlIZWFwKHNjb3JlRnVuY3Rpb24pe1xuICB0aGlzLmNvbnRlbnQgPSBbXTtcbiAgdGhpcy5zY29yZUZ1bmN0aW9uID0gc2NvcmVGdW5jdGlvbjtcbn1cblxuQmluYXJ5SGVhcC5wcm90b3R5cGUgPSB7XG4gIHB1c2g6IGZ1bmN0aW9uKGVsZW1lbnQpIHtcbiAgICAvLyBBZGQgdGhlIG5ldyBlbGVtZW50IHRvIHRoZSBlbmQgb2YgdGhlIGFycmF5LlxuICAgIHRoaXMuY29udGVudC5wdXNoKGVsZW1lbnQpO1xuICAgIC8vIEFsbG93IGl0IHRvIGJ1YmJsZSB1cC5cbiAgICB0aGlzLmJ1YmJsZVVwKHRoaXMuY29udGVudC5sZW5ndGggLSAxKTtcbiAgfSxcblxuICBwb3A6IGZ1bmN0aW9uKCkge1xuICAgIC8vIFN0b3JlIHRoZSBmaXJzdCBlbGVtZW50IHNvIHdlIGNhbiByZXR1cm4gaXQgbGF0ZXIuXG4gICAgdmFyIHJlc3VsdCA9IHRoaXMuY29udGVudFswXTtcbiAgICAvLyBHZXQgdGhlIGVsZW1lbnQgYXQgdGhlIGVuZCBvZiB0aGUgYXJyYXkuXG4gICAgdmFyIGVuZCA9IHRoaXMuY29udGVudC5wb3AoKTtcbiAgICAvLyBJZiB0aGVyZSBhcmUgYW55IGVsZW1lbnRzIGxlZnQsIHB1dCB0aGUgZW5kIGVsZW1lbnQgYXQgdGhlXG4gICAgLy8gc3RhcnQsIGFuZCBsZXQgaXQgc2luayBkb3duLlxuICAgIGlmICh0aGlzLmNvbnRlbnQubGVuZ3RoID4gMCkge1xuICAgICAgdGhpcy5jb250ZW50WzBdID0gZW5kO1xuICAgICAgdGhpcy5zaW5rRG93bigwKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSxcblxuICBwZWVrOiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5jb250ZW50WzBdO1xuICB9LFxuXG4gIHJlbW92ZTogZnVuY3Rpb24obm9kZSkge1xuICAgIHZhciBsZW4gPSB0aGlzLmNvbnRlbnQubGVuZ3RoO1xuICAgIC8vIFRvIHJlbW92ZSBhIHZhbHVlLCB3ZSBtdXN0IHNlYXJjaCB0aHJvdWdoIHRoZSBhcnJheSB0byBmaW5kXG4gICAgLy8gaXQuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgICAgaWYgKHRoaXMuY29udGVudFtpXSA9PSBub2RlKSB7XG4gICAgICAgIC8vIFdoZW4gaXQgaXMgZm91bmQsIHRoZSBwcm9jZXNzIHNlZW4gaW4gJ3BvcCcgaXMgcmVwZWF0ZWRcbiAgICAgICAgLy8gdG8gZmlsbCB1cCB0aGUgaG9sZS5cbiAgICAgICAgdmFyIGVuZCA9IHRoaXMuY29udGVudC5wb3AoKTtcbiAgICAgICAgaWYgKGkgIT0gbGVuIC0gMSkge1xuICAgICAgICAgIHRoaXMuY29udGVudFtpXSA9IGVuZDtcbiAgICAgICAgICBpZiAodGhpcy5zY29yZUZ1bmN0aW9uKGVuZCkgPCB0aGlzLnNjb3JlRnVuY3Rpb24obm9kZSkpXG4gICAgICAgICAgICB0aGlzLmJ1YmJsZVVwKGkpO1xuICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgIHRoaXMuc2lua0Rvd24oaSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJOb2RlIG5vdCBmb3VuZC5cIik7XG4gIH0sXG5cbiAgc2l6ZTogZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuY29udGVudC5sZW5ndGg7XG4gIH0sXG5cbiAgYnViYmxlVXA6IGZ1bmN0aW9uKG4pIHtcbiAgICAvLyBGZXRjaCB0aGUgZWxlbWVudCB0aGF0IGhhcyB0byBiZSBtb3ZlZC5cbiAgICB2YXIgZWxlbWVudCA9IHRoaXMuY29udGVudFtuXTtcbiAgICAvLyBXaGVuIGF0IDAsIGFuIGVsZW1lbnQgY2FuIG5vdCBnbyB1cCBhbnkgZnVydGhlci5cbiAgICB3aGlsZSAobiA+IDApIHtcbiAgICAgIC8vIENvbXB1dGUgdGhlIHBhcmVudCBlbGVtZW50J3MgaW5kZXgsIGFuZCBmZXRjaCBpdC5cbiAgICAgIHZhciBwYXJlbnROID0gTWF0aC5mbG9vcigobiArIDEpIC8gMikgLSAxLFxuICAgICAgICAgIHBhcmVudCA9IHRoaXMuY29udGVudFtwYXJlbnROXTtcbiAgICAgIC8vIFN3YXAgdGhlIGVsZW1lbnRzIGlmIHRoZSBwYXJlbnQgaXMgZ3JlYXRlci5cbiAgICAgIGlmICh0aGlzLnNjb3JlRnVuY3Rpb24oZWxlbWVudCkgPCB0aGlzLnNjb3JlRnVuY3Rpb24ocGFyZW50KSkge1xuICAgICAgICB0aGlzLmNvbnRlbnRbcGFyZW50Tl0gPSBlbGVtZW50O1xuICAgICAgICB0aGlzLmNvbnRlbnRbbl0gPSBwYXJlbnQ7XG4gICAgICAgIC8vIFVwZGF0ZSAnbicgdG8gY29udGludWUgYXQgdGhlIG5ldyBwb3NpdGlvbi5cbiAgICAgICAgbiA9IHBhcmVudE47XG4gICAgICB9XG4gICAgICAvLyBGb3VuZCBhIHBhcmVudCB0aGF0IGlzIGxlc3MsIG5vIG5lZWQgdG8gbW92ZSBpdCBmdXJ0aGVyLlxuICAgICAgZWxzZSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfSxcblxuICBzaW5rRG93bjogZnVuY3Rpb24obikge1xuICAgIC8vIExvb2sgdXAgdGhlIHRhcmdldCBlbGVtZW50IGFuZCBpdHMgc2NvcmUuXG4gICAgdmFyIGxlbmd0aCA9IHRoaXMuY29udGVudC5sZW5ndGgsXG4gICAgICAgIGVsZW1lbnQgPSB0aGlzLmNvbnRlbnRbbl0sXG4gICAgICAgIGVsZW1TY29yZSA9IHRoaXMuc2NvcmVGdW5jdGlvbihlbGVtZW50KTtcblxuICAgIHdoaWxlKHRydWUpIHtcbiAgICAgIC8vIENvbXB1dGUgdGhlIGluZGljZXMgb2YgdGhlIGNoaWxkIGVsZW1lbnRzLlxuICAgICAgdmFyIGNoaWxkMk4gPSAobiArIDEpICogMiwgY2hpbGQxTiA9IGNoaWxkMk4gLSAxO1xuICAgICAgLy8gVGhpcyBpcyB1c2VkIHRvIHN0b3JlIHRoZSBuZXcgcG9zaXRpb24gb2YgdGhlIGVsZW1lbnQsXG4gICAgICAvLyBpZiBhbnkuXG4gICAgICB2YXIgc3dhcCA9IG51bGw7XG4gICAgICAvLyBJZiB0aGUgZmlyc3QgY2hpbGQgZXhpc3RzIChpcyBpbnNpZGUgdGhlIGFycmF5KS4uLlxuICAgICAgaWYgKGNoaWxkMU4gPCBsZW5ndGgpIHtcbiAgICAgICAgLy8gTG9vayBpdCB1cCBhbmQgY29tcHV0ZSBpdHMgc2NvcmUuXG4gICAgICAgIHZhciBjaGlsZDEgPSB0aGlzLmNvbnRlbnRbY2hpbGQxTl0sXG4gICAgICAgICAgICBjaGlsZDFTY29yZSA9IHRoaXMuc2NvcmVGdW5jdGlvbihjaGlsZDEpO1xuICAgICAgICAvLyBJZiB0aGUgc2NvcmUgaXMgbGVzcyB0aGFuIG91ciBlbGVtZW50J3MsIHdlIG5lZWQgdG8gc3dhcC5cbiAgICAgICAgaWYgKGNoaWxkMVNjb3JlIDwgZWxlbVNjb3JlKVxuICAgICAgICAgIHN3YXAgPSBjaGlsZDFOO1xuICAgICAgfVxuICAgICAgLy8gRG8gdGhlIHNhbWUgY2hlY2tzIGZvciB0aGUgb3RoZXIgY2hpbGQuXG4gICAgICBpZiAoY2hpbGQyTiA8IGxlbmd0aCkge1xuICAgICAgICB2YXIgY2hpbGQyID0gdGhpcy5jb250ZW50W2NoaWxkMk5dLFxuICAgICAgICAgICAgY2hpbGQyU2NvcmUgPSB0aGlzLnNjb3JlRnVuY3Rpb24oY2hpbGQyKTtcbiAgICAgICAgaWYgKGNoaWxkMlNjb3JlIDwgKHN3YXAgPT0gbnVsbCA/IGVsZW1TY29yZSA6IGNoaWxkMVNjb3JlKSl7XG4gICAgICAgICAgc3dhcCA9IGNoaWxkMk47XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gSWYgdGhlIGVsZW1lbnQgbmVlZHMgdG8gYmUgbW92ZWQsIHN3YXAgaXQsIGFuZCBjb250aW51ZS5cbiAgICAgIGlmIChzd2FwICE9IG51bGwpIHtcbiAgICAgICAgdGhpcy5jb250ZW50W25dID0gdGhpcy5jb250ZW50W3N3YXBdO1xuICAgICAgICB0aGlzLmNvbnRlbnRbc3dhcF0gPSBlbGVtZW50O1xuICAgICAgICBuID0gc3dhcDtcbiAgICAgIH1cbiAgICAgIC8vIE90aGVyd2lzZSwgd2UgYXJlIGRvbmUuXG4gICAgICBlbHNlIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgY3JlYXRlS2RUcmVlOiBmdW5jdGlvbiAocG9pbnRzLCBtZXRyaWMsIGRpbWVuc2lvbnMpIHtcbiAgICByZXR1cm4gbmV3IEtkVHJlZShwb2ludHMsIG1ldHJpYywgZGltZW5zaW9ucylcbiAgfVxufVxuIl19
