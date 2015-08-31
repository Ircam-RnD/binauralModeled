(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.BinauralModeled = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
module.exports = require('./dist/binaural-modeled');

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

},{"babel-runtime/helpers/class-call-check":4,"babel-runtime/helpers/create-class":5,"babel-runtime/helpers/interop-require-default":6,"biquad-filter":10,"fractional-delay":18,"kdt":9}],3:[function(require,module,exports){
module.exports = { "default": require("core-js/library/fn/object/define-property"), __esModule: true };
},{"core-js/library/fn/object/define-property":7}],4:[function(require,module,exports){
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
"use strict";

exports["default"] = function (obj) {
  return obj && obj.__esModule ? obj : {
    "default": obj
  };
};

exports.__esModule = true;
},{}],7:[function(require,module,exports){
var $ = require('../../modules/$');
module.exports = function defineProperty(it, key, desc){
  return $.setDesc(it, key, desc);
};
},{"../../modules/$":8}],8:[function(require,module,exports){
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
},{}],9:[function(require,module,exports){
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

},{}],10:[function(require,module,exports){
module.exports = require('./dist/biquad-filter');

},{"./dist/biquad-filter":11}],11:[function(require,module,exports){
/**
 * @fileoverview Biquad Filter library
 * @author Arnau.Julia <Arnau.Julia@gmail.com>
 * @version 0.1.0
 */

/**
 * @class BiquadFilter
 * @public
 */
"use strict";

var _createClass = require("babel-runtime/helpers/create-class")["default"];

var _classCallCheck = require("babel-runtime/helpers/class-call-check")["default"];

Object.defineProperty(exports, "__esModule", {
    value: true
});

var BiquadFilter = (function () {
    function BiquadFilter() {
        _classCallCheck(this, BiquadFilter);

        this.coefficients = [];
        this.numberOfCascade = 1;
        this.resetMemories();
    }

    /**
     * Set biquad filter coefficients
     * @public
     * @param coef Array of biquad coefficients in the following order: gain, firstBiquad b1, firstBiquad b2, firstBiquad a1, firstBiquad a2, secondBiquad b1, secondBIquad b2, etc.
     */

    _createClass(BiquadFilter, [{
        key: "setCoefficients",
        value: function setCoefficients(coef) {
            if (coef) {
                // If there is not a number of biquads, we consider that there is only 1 biquad.
                this.numberOfCascade = this.getNumberOfCascadeFilters(coef);
                // Reset coefficients
                this.coefficients = [];
                // Global gain
                this.coefficients.g = coef[0];
                for (var i = 0; i < this.numberOfCascade; i++) {
                    // Four coefficients for each biquad
                    this.coefficients[i] = {
                        b1: coef[1 + i * 4],
                        b2: coef[2 + i * 4],
                        a1: coef[3 + i * 4],
                        a2: coef[4 + i * 4]
                    };
                }
                // Need to reset the memories after change the coefficients
                this.resetMemories();
                return true;
            } else {
                throw new Error("No coefficients are set");
            }
        }

        /**
         * Get the number of cascade filters from the list of coefficients
         * @private
         */
    }, {
        key: "getNumberOfCascadeFilters",
        value: function getNumberOfCascadeFilters(coef) {
            return (coef.length - 1) / 4;
        }

        /**
         * Reset memories of biquad filters.
         * @public
         */
    }, {
        key: "resetMemories",
        value: function resetMemories() {
            this.memories = [{
                xi1: 0,
                xi2: 0,
                yi1: 0,
                yi2: 0
            }];
            // see http://stackoverflow.com/a/19892144
            for (var i = 1; i < this.numberOfCascade; i++) {
                this.memories[i] = {
                    yi1: 0,
                    yi2: 0
                };
            }
        }

        /**
         * Calculate the output of the cascade of biquad filters for an inputBuffer.
         * @public
         * @param inputBuffer Array of the same length of outputBuffer
         * @param outputBuffer Array of the same length of inputBuffer
         */
    }, {
        key: "process",
        value: function process(inputBuffer, outputBuffer) {
            var x;
            var y = [];
            var b1, b2, a1, a2;
            var xi1, xi2, yi1, yi2, y1i1, y1i2;

            for (var i = 0; i < inputBuffer.length; i++) {
                x = inputBuffer[i];
                // Save coefficients in local variables
                b1 = this.coefficients[0].b1;
                b2 = this.coefficients[0].b2;
                a1 = this.coefficients[0].a1;
                a2 = this.coefficients[0].a2;
                // Save memories in local variables
                xi1 = this.memories[0].xi1;
                xi2 = this.memories[0].xi2;
                yi1 = this.memories[0].yi1;
                yi2 = this.memories[0].yi2;

                // Formula: y[n] = x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
                // First biquad
                y[0] = x + b1 * xi1 + b2 * xi2 - a1 * yi1 - a2 * yi2;

                for (var e = 1; e < this.numberOfCascade; e++) {
                    // Save coefficients in local variables
                    b1 = this.coefficients[e].b1;
                    b2 = this.coefficients[e].b2;
                    a1 = this.coefficients[e].a1;
                    a2 = this.coefficients[e].a2;
                    // Save memories in local variables
                    y1i1 = this.memories[e - 1].yi1;
                    y1i2 = this.memories[e - 1].yi2;
                    yi1 = this.memories[e].yi1;
                    yi2 = this.memories[e].yi2;

                    y[e] = y[e - 1] + b1 * y1i1 + b2 * y1i2 - a1 * yi1 - a2 * yi2;
                }

                // Write the output
                outputBuffer[i] = y[this.numberOfCascade - 1] * this.coefficients.g;

                // Update the memories
                this.memories[0].xi2 = this.memories[0].xi1;
                this.memories[0].xi1 = x;

                for (var p = 0; p < this.numberOfCascade; p++) {
                    this.memories[p].yi2 = this.memories[p].yi1;
                    this.memories[p].yi1 = y[p];
                }
            }
        }
    }]);

    return BiquadFilter;
})();

exports["default"] = BiquadFilter;
module.exports = exports["default"];

},{"babel-runtime/helpers/class-call-check":13,"babel-runtime/helpers/create-class":14}],12:[function(require,module,exports){
arguments[4][3][0].apply(exports,arguments)
},{"core-js/library/fn/object/define-property":15,"dup":3}],13:[function(require,module,exports){
arguments[4][4][0].apply(exports,arguments)
},{"dup":4}],14:[function(require,module,exports){
arguments[4][5][0].apply(exports,arguments)
},{"babel-runtime/core-js/object/define-property":12,"dup":5}],15:[function(require,module,exports){
arguments[4][7][0].apply(exports,arguments)
},{"../../modules/$":16,"dup":7}],16:[function(require,module,exports){
arguments[4][8][0].apply(exports,arguments)
},{"dup":8}],17:[function(require,module,exports){
/**
 * @fileoverview Fractional delay library
 * @author Arnau Julià <Arnau.Julia@gmail.com>
 * @version 0.1.0
 */
/**
 * @class FractionalDelay
 * @public
 */
"use strict";

var _createClass = require("babel-runtime/helpers/create-class")["default"];

var _classCallCheck = require("babel-runtime/helpers/class-call-check")["default"];

Object.defineProperty(exports, "__esModule", {
    value: true
});

var FractionalDelay = (function () {
    /**
     * Mandatory initialization method.
     * @public
     * @param units:Hz sampleRate Sample Rate the apparatus operates on.
     * @param type:Float units:s min:0.0 default:1 optMaxDelayTime The maximum delay time.
     * @chainable
     */

    function FractionalDelay(sampleRate, optMaxDelayTime) {
        _classCallCheck(this, FractionalDelay);

        // Properties with default values
        this.delayTime = 0;
        this.posRead = 0;
        this.posWrite = 0;
        this.fracXi1 = 0;
        this.fracYi1 = 0;
        this.intDelay = 0;
        this.fracDelay = 0;

        // Other properties
        this.a1 = undefined;

        // Save sample rate
        this.sampleRate = sampleRate;
        this.maxDelayTime = optMaxDelayTime || 1;

        this.bufferSize = this.maxDelayTime * this.sampleRate;
        // Check if the bufferSize is not an integer
        if (this.bufferSize % 1 !== 0) {
            this.bufferSize = parseInt(this.bufferSize) + 1;
        }
        // Create the internal buffer
        this.buffer = new Float32Array(this.bufferSize);
    }

    /**
     * Set delay value
     * @param delayTime Delay time
     * @public
     */

    _createClass(FractionalDelay, [{
        key: "setDelay",
        value: function setDelay(delayTime) {
            if (delayTime < this.maxDelayTime) {
                // Save delay value
                this.delayTime = delayTime;
                // Transform time in samples
                var samplesDelay = delayTime * this.sampleRate;
                // Get the integer part of samplesDelay
                this.intDelay = parseInt(samplesDelay);
                // Get the fractional part of samplesDelay
                this.fracDelay = samplesDelay - this.intDelay;
                // Update the value of the pointer
                this.resample();
                // If the delay has fractional part, update the Thiran Coefficients
                if (this.fracDelay !== 0) {
                    this.updateThiranCoefficient();
                }
            } else {
                throw new Error("delayTime > maxDelayTime");
            }
        }

        /**
         * Update delay value
         * @public
         */
    }, {
        key: "getDelay",
        value: function getDelay() {
            return this.delayTime;
        }

        /**
         * Process method, where the output is calculated.
         * @param inputBuffer Input Array
         * @public
         */
    }, {
        key: "process",
        value: function process(inputBuffer) {
            // Creates the outputBuffer, with the same length of the input
            var outputBuffer = new Float32Array(inputBuffer.length);

            // Integer delay process section
            for (var i = 0; i < inputBuffer.length; i = i + 1) {
                // Save the input value in the buffer
                this.buffer[this.posWrite] = inputBuffer[i];
                // Write the outputBuffer with the [inputValue - delay] sample
                outputBuffer[i] = this.buffer[this.posRead];
                // Update the value of posRead and posWrite pointers
                this.updatePointers();
            }
            // No fractional delay
            if (this.fracDelay === 0) {
                return outputBuffer;
            } else {
                // The fractional delay process section
                outputBuffer = new Float32Array(this.fractionalThiranProcess(outputBuffer));
                return outputBuffer;
            }
        }

        /**
         * Update the value of posRead and posWrite pointers inside the circular buffer
         * @private
         */
    }, {
        key: "updatePointers",
        value: function updatePointers() {
            // It's a circular buffer, so, when it is at the last position, the pointer return to the first position

            // Update posWrite pointer
            if (this.posWrite === this.buffer.length - 1) {
                this.posWrite = 0;
            } else {
                this.posWrite = this.posWrite + 1;
            }

            // Update posRead pointer
            if (this.posRead === this.buffer.length - 1) {
                this.posRead = 0;
            } else {
                this.posRead = this.posRead + 1;
            }
        }

        /**
         * Update Thiran coefficient (1st order Thiran)
         * @private
         */
    }, {
        key: "updateThiranCoefficient",
        value: function updateThiranCoefficient() {
            // Update the coefficient: (1-D)/(1+D) where D is fractional delay
            this.a1 = (1 - this.fracDelay) / (1 + this.fracDelay);
        }

        /**
         * Update the pointer posRead value when the delay value is changed
         * @private
         */
    }, {
        key: "resample",
        value: function resample() {
            if (this.posWrite - this.intDelay < 0) {
                var pos = this.intDelay - this.posWrite;
                this.posRead = this.buffer.length - pos;
            } else {
                this.posRead = this.posWrite - this.intDelay;
            }
        }

        /**
         * Fractional process method.
         * @private
         * @param inputBuffer Input Array
         */
    }, {
        key: "fractionalThiranProcess",
        value: function fractionalThiranProcess(inputBuffer) {
            var outputBuffer = new Float32Array(inputBuffer.length);

            var x, y;
            var xi1 = this.fracXi1;
            var yi1 = this.fracYi1;

            for (var i = 0; i < inputBuffer.length; i = i + 1) {
                // Current input sample
                x = inputBuffer[i];

                // Calculate the output
                y = this.a1 * x + xi1 - this.a1 * yi1;

                // Update the memories
                xi1 = x;
                yi1 = y;
                // Save the outputBuffer
                outputBuffer[i] = y;
            }
            // Save memories
            this.fracXi1 = xi1;
            this.fracYi1 = yi1;

            return outputBuffer;
        }
    }]);

    return FractionalDelay;
})();

exports["default"] = FractionalDelay;
module.exports = exports["default"];

},{"babel-runtime/helpers/class-call-check":20,"babel-runtime/helpers/create-class":21}],18:[function(require,module,exports){
module.exports = require('./dist/fractional-delay');

},{"./dist/fractional-delay":17}],19:[function(require,module,exports){
arguments[4][3][0].apply(exports,arguments)
},{"core-js/library/fn/object/define-property":22,"dup":3}],20:[function(require,module,exports){
arguments[4][4][0].apply(exports,arguments)
},{"dup":4}],21:[function(require,module,exports){
arguments[4][5][0].apply(exports,arguments)
},{"babel-runtime/core-js/object/define-property":19,"dup":5}],22:[function(require,module,exports){
arguments[4][7][0].apply(exports,arguments)
},{"../../modules/$":23,"dup":7}],23:[function(require,module,exports){
arguments[4][8][0].apply(exports,arguments)
},{"dup":8}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJiaW5hdXJhbC1tb2RlbGVkLmpzIiwiZGlzdC9lczYvYmluYXVyYWwtbW9kZWxlZC5qcyIsIm5vZGVfbW9kdWxlcy9iYWJlbC1ydW50aW1lL2NvcmUtanMvb2JqZWN0L2RlZmluZS1wcm9wZXJ0eS5qcyIsIm5vZGVfbW9kdWxlcy9iYWJlbC1ydW50aW1lL2hlbHBlcnMvY2xhc3MtY2FsbC1jaGVjay5qcyIsIm5vZGVfbW9kdWxlcy9iYWJlbC1ydW50aW1lL2hlbHBlcnMvY3JlYXRlLWNsYXNzLmpzIiwibm9kZV9tb2R1bGVzL2JhYmVsLXJ1bnRpbWUvaGVscGVycy9pbnRlcm9wLXJlcXVpcmUtZGVmYXVsdC5qcyIsIm5vZGVfbW9kdWxlcy9iYWJlbC1ydW50aW1lL25vZGVfbW9kdWxlcy9jb3JlLWpzL2xpYnJhcnkvZm4vb2JqZWN0L2RlZmluZS1wcm9wZXJ0eS5qcyIsIm5vZGVfbW9kdWxlcy9iYWJlbC1ydW50aW1lL25vZGVfbW9kdWxlcy9jb3JlLWpzL2xpYnJhcnkvbW9kdWxlcy8kLmpzIiwibm9kZV9tb2R1bGVzL2tkdC9pbmRleC5qcyIsIi4uL2JpcXVhZC1maWx0ZXIvYmlxdWFkLWZpbHRlci5qcyIsIi4uL2JpcXVhZC1maWx0ZXIvZGlzdC9lczYvYmlxdWFkLWZpbHRlci5lczYuanMiLCIuLi9mcmFjdGlvbmFsLWRlbGF5L2Rpc3QvZXM2L2ZyYWN0aW9uYWwtZGVsYXkuanMiLCIuLi9mcmFjdGlvbmFsLWRlbGF5L2ZyYWN0aW9uYWwtZGVsYXkuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OzttQkNLZ0IsS0FBSzs7Ozs0QkFDSSxlQUFlOzs7OytCQUNaLGtCQUFrQjs7Ozs7Ozs7SUFNekIsZUFBZTs7Ozs7OztBQU12QixXQU5RLGVBQWUsQ0FNdEIsT0FBTyxFQUFFOzBC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QUksQ0FBQyxDQUFDO0FBQy9CLGFBQU8sSUFBSSxDQUFDO0tBQ2I7OztTQWxFTyxlQUFHO0FBQ1QsYUFBTyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQztLQUMzQjs7O1NBdkJHLG9CQUFvQjs7Ozs7O0FDalYxQjs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7O0FDSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0Y0E7QUFDQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztJQ1NxQixZQUFZO0FBQ2xCLGFBRE0sWUFBWSxHQUNmOzhCQURHLFlBQVk7O0FBRXpCLFlBQUksQ0FBQyxZQUFZLEdBQUcsRUFBRSxDQUFDO0FBQ3ZCLFlBQUksQ0FBQyxlQUFlLEdBQUcsQ0FBQyxDQUFDO0FBQ3pCLFlBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztLQUN4Qjs7Ozs7Ozs7aUJBTGdCLFlBQVk7O2VBWWQseUJBQUMsSUFBSSxFQUFFO0FBQ2xCLGdCQUFJLElBQUksRUFBRTs7QUFFTixvQkFBSSxDQUFDLGVBQWUsR0FBRyxJQUFJLENBQUMseUJBQXlCLENBQUMsSUFBSSxDQUFDLENBQUM7O0FBRTVELG9CQUFJLENBQUMsWUFBWSxHQUFHLEVBQUUsQ0FBQzs7QUFFdkIsb0JBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUM5QixxQkFBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQyxFQUFFLEVBQUU7O0FBRTNDLHdCQUFJLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxHQUFHO0FBQ25CLDBCQUFFLEVBQUUsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ25CLDBCQUFFLEVBQUUsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ25CLDBCQUFFLEVBQUUsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ25CLDBCQUFFLEVBQUUsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO3FCQUN0QixDQUFDO2lCQUNMOztBQUVELG9CQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7QUFDckIsdUJBQU8sSUFBSSxDQUFDO2FBQ2YsTUFBTTtBQUNILHNCQUFNLElBQUksS0FBSyxDQUFDLHlCQUF5QixDQUFDLENBQUM7YUFDOUM7U0FDSjs7Ozs7Ozs7ZUFNd0IsbUNBQUMsSUFBSSxFQUFFO0FBQzVCLG1CQUFPLENBQUMsSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUEsR0FBSSxDQUFDLENBQUM7U0FDaEM7Ozs7Ozs7O2VBTVkseUJBQUc7QUFDWixnQkFBSSxDQUFDLFFBQVEsR0FBRyxDQUFDO0FBQ2IsbUJBQUcsRUFBRSxDQUFDO0FBQ04sbUJBQUcsRUFBRSxDQUFDO0FBQ04sbUJBQUcsRUFBRSxDQUFDO0FBQ04sbUJBQUcsRUFBRSxDQUFDO2FBQ1QsQ0FBQyxDQUFDOztBQUVILGlCQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDLEVBQUUsRUFBRTtBQUMzQyxvQkFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsR0FBRztBQUNmLHVCQUFHLEVBQUUsQ0FBQztBQUNOLHVCQUFHLEVBQUUsQ0FBQztpQkFDVCxDQUFDO2FBQ0w7U0FDSjs7Ozs7Ozs7OztlQVFNLGlCQUFDLFdBQVcsRUFBRSxZQUFZLEVBQUU7QUFDL0IsZ0JBQUksQ0FBQyxDQUFDO0FBQ04sZ0JBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztBQUNYLGdCQUFJLEVBQUUsRUFBRSxFQUFFLEVBQUUsRUFBRSxFQUFFLEVBQUUsQ0FBQztBQUNuQixnQkFBSSxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQzs7QUFFbkMsaUJBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxXQUFXLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO0FBQ3pDLGlCQUFDLEdBQUcsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDOztBQUVuQixrQkFBRSxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0FBQzdCLGtCQUFFLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7QUFDN0Isa0JBQUUsR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztBQUM3QixrQkFBRSxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDOztBQUU3QixtQkFBRyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDO0FBQzNCLG1CQUFHLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUM7QUFDM0IsbUJBQUcsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQztBQUMzQixtQkFBRyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDOzs7O0FBSTNCLGlCQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsR0FBRyxHQUFHLEdBQUcsRUFBRSxHQUFHLEdBQUcsR0FBRyxFQUFFLEdBQUcsR0FBRyxHQUFHLEVBQUUsR0FBRyxHQUFHLENBQUM7O0FBRXJELHFCQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDLEVBQUUsRUFBRTs7QUFFM0Msc0JBQUUsR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztBQUM3QixzQkFBRSxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0FBQzdCLHNCQUFFLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7QUFDN0Isc0JBQUUsR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQzs7QUFFN0Isd0JBQUksR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFH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Ozs7OztlQU9zQixpQ0FBQyxXQUFXLEVBQUU7QUFDakMsZ0JBQUksWUFBWSxHQUFHLElBQUksWUFBWSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQzs7QUFFeEQsZ0JBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUNULGdCQUFJLEdBQUcsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDO0FBQ3ZCLGdCQUFJLEdBQUcsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDOztBQUV2QixpQkFBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLFdBQVcsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEVBQUU7O0FBRS9DLGlCQUFDLEdBQUcsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDOzs7QUFHbkIsaUJBQUMsR0FBRyxJQUFJLENBQUMsRUFBRSxHQUFHLENBQUMsR0FBRyxHQUFHLEdBQUcsSUFBSSxDQUFDLEVBQUUsR0FBRyxHQUFHLENBQUM7OztBQUd0QyxtQkFBRyxHQUFHLENBQUMsQ0FBQztBQUNSLG1CQUFHLEdBQUcsQ0FBQyxDQUFDOztBQUVSLDRCQUFZLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO2FBRXZCOztBQUVELGdCQUFJLENBQUMsT0FBTyxHQUFHLEdBQUcsQ0FBQztBQUNuQixnQkFBSSxDQUFDLE9BQU8sR0FBRyxHQUFHLENBQUM7O0FBRW5CLG1CQUFPLFlBQVksQ0FBQztTQUN2Qjs7O1dBM0tnQixlQUFlOzs7cUJBQWYsZUFBZTs7OztBQ1RwQztBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9kaXN0L2JpbmF1cmFsLW1vZGVsZWQnKTtcbiIsIi8qKlxuICogQGZpbGVPdmVydmlld1xuICpcbiAqIEBhdXRob3IgQXJuYXUgSnVsacOgIDxBcm5hdS5KdWxpYUBnbWFpbC5jb20+XG4gKiBAdmVyc2lvbiAwLjEuMFxuICovXG5pbXBvcnQga2R0IGZyb20gJ2tkdCc7XG5pbXBvcnQgQmlxdWFkRmlsdGVyIGZyb20gJ2JpcXVhZC1maWx0ZXInO1xuaW1wb3J0IEZyYWN0aW9uYWxEZWxheSBmcm9tICdmcmFjdGlvbmFsLWRlbGF5JztcblxuXG4vKipcbiAqIEBjbGFzcyBCaW5hdXJhbE1vZGVsZWRcbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmluYXVyYWxNb2RlbGVkIHtcbiAgLyoqXG4gICAqIE1hbmRhdG9yeSBpbml0aWFsaXphdGlvbiBtZXRob2QuXG4gICAqIEBwdWJsaWNcbiAgICogQGNoYWluYWJsZVxuICAgKi9cbiAgY29uc3RydWN0b3Iob3B0aW9ucykge1xuICAgIHRoaXMuYXVkaW9Db250ZXh0ID0gb3B0aW9ucy5hdWRpb0NvbnRleHQ7XG4gICAgLy8gUHJpdmF0ZSBwcm9wZXJ0aWVzXG4gICAgdGhpcy5ocnRmRGF0YXNldCA9IHVuZGVmaW5lZDtcbiAgICB0aGlzLmhydGZEYXRhc2V0TGVuZ3RoID0gdW5kZWZpbmVkO1xuICAgIHRoaXMubmV4dFBvc2l0aW9uID0gW107XG4gICAgdGhpcy5jaGFuZ2VXaGVuRmluaXNoQ3Jvc3NmYWRpbmcgPSBmYWxzZTtcbiAgICB0aGlzLnBvc2l0aW9uID0gW107XG4gICAgdGhpcy5jcm9zc2ZhZGVEdXJhdGlvbiA9IDIwIC8gMTAwMDtcbiAgICB0aGlzLmJ1ZmZlclNpemUgPSAxMDI0O1xuICAgIHRoaXMudHJlZSA9IC0xO1xuXG4gICAgdGhpcy5pbnB1dCA9IHRoaXMuYXVkaW9Db250ZXh0LmNyZWF0ZUdhaW4oKTtcblxuICAgIC8vIFR3byBzdWIgYXVkaW8gZ3JhcGhzIGNyZWF0aW9uOlxuICAgIC8vIC0gbWFpbkNvbnZvbHZlciB3aGljaCByZXByZXNlbnRzIHRoZSBjdXJyZW50IHN0YXRlXG4gICAgLy8gLSBhbmQgc2Vjb25kYXJ5Q29udm9sdmVyIHdoaWNoIHJlcHJlc2VudHMgdGhlIHBvdGVudGlhbCB0YXJnZXQgc3RhdGVcbiAgICAvLyAgIHdoZW4gbW92aW5nIHNvdW5kIHRvIGEgbmV3IHBvc2l0aW9uXG5cbiAgICB0aGlzLm1haW5BdWRpb0dyYXBoID0gbmV3IFByb2Nlc3NpbmdBdWRpb0dyYXBoKHtcbiAgICAgIGF1ZGlvQ29udGV4dDogdGhpcy5hdWRpb0NvbnRleHRcbiAgICB9KTtcbiAgICB0aGlzLm1haW5BdWRpb0dyYXBoLmdhaW4udmFsdWUgPSAxO1xuICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLm1haW5BdWRpb0dyYXBoLmlucHV0KTtcblxuICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaCA9IG5ldyBQcm9jZXNzaW5nQXVkaW9HcmFwaCh7XG4gICAgICBhdWRpb0NvbnRleHQ6IHRoaXMuYXVkaW9Db250ZXh0XG4gICAgfSk7XG4gICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLmdhaW4udmFsdWUgPSAwO1xuICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguaW5wdXQpO1xuICAgIC8vIFdlYiBBdWRpb1xuICAgIHRoaXMuc2FtcGxlUmF0ZSA9IHRoaXMuYXVkaW9Db250ZXh0LnNhbXBsZVJhdGU7XG4gICAgLy9Db25uZWN0aW9uc1xuICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLm1haW5BdWRpb0dyYXBoLmlucHV0KTtcbiAgICB0aGlzLmlucHV0LmNvbm5lY3QodGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLmlucHV0KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25uZWN0cyB0aGUgYmluYXVyYWxNb2RlbGVkTm9kZSB0byB0aGUgV2ViIEF1ZGlvIGdyYXBoXG4gICAqIEBwdWJsaWNcbiAgICogQGNoYWluYWJsZVxuICAgKiBAcGFyYW0gbm9kZSBEZXN0aW5hdGlvbiBub2RlXG4gICAqL1xuICBjb25uZWN0KG5vZGUpIHtcbiAgICB0aGlzLm1haW5BdWRpb0dyYXBoLmNvbm5lY3Qobm9kZSk7XG4gICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLmNvbm5lY3Qobm9kZSk7XG4gICAgcmV0dXJuIHRoaXM7IC8vIEZvciBjaGFpbmFiaWxpdHlcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNjb25uZWN0IHRoZSBiaW5hdXJhbE1vZGVsZWROb2RlIGZyb20gdGhlIFdlYiBBdWRpbyBncmFwaFxuICAgKiBAcHVibGljXG4gICAqIEBjaGFpbmFibGVcbiAgICogQHBhcmFtIG5vZGUgRGVzdGluYXRpb24gbm9kZVxuICAgKi9cbiAgZGlzY29ubmVjdChub2RlKSB7XG4gICAgdGhpcy5tYWluQXVkaW9HcmFwaC5kaXNjb25uZWN0KG5vZGUpO1xuICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5kaXNjb25uZWN0KG5vZGUpO1xuICAgIHJldHVybiB0aGlzOyAvLyBGb3IgY2hhaW5hYmlsaXR5XG4gIH1cblxuICAvKipcbiAgICogU2V0IEhSVEYgRGF0YXNldCB0byBiZSB1c2VkIHdpdGggdGhlIHZpcnR1YWwgc291cmNlLlxuICAgKiBAcHVibGljXG4gICAqIEBjaGFpbmFibGVcbiAgICogQHBhcmFtIGhydGZEYXRhc2V0IEFycmF5IG9mIE9iamVjdHMgY29udGFpbmluZyB0aGUgYXppbXV0aCwgZGlzdGFuY2UsIGVsZXZhdGlvbiwgdXJsIGFuZCBidWZmZXIgZm9yIGVhY2ggcG9pbnRcbiAgICovXG4gIHNldCBIUlRGRGF0YXNldChocnRmRGF0YXNldCkge1xuICAgIHRoaXMuaHJ0ZkRhdGFzZXQgPSBocnRmRGF0YXNldDtcbiAgICB0aGlzLmhydGZEYXRhc2V0TGVuZ3RoID0gdGhpcy5ocnRmRGF0YXNldC5sZW5ndGg7XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuaHJ0ZkRhdGFzZXRMZW5ndGg7IGkrKykge1xuICAgICAgdmFyIGhydGYgPSB0aGlzLmhydGZEYXRhc2V0W2ldO1xuICAgICAgLy8gQXppbXV0aCBhbmQgZWxldmF0aW9uIHRvIHJhZGlhbnNcbiAgICAgIHZhciBhemltdXRoUmFkaWFucyA9IGhydGYuYXppbXV0aCAqIE1hdGguUEkgLyAxODA7XG4gICAgICB2YXIgZWxldmF0aW9uUmFkaWFucyA9IGhydGYuZWxldmF0aW9uICogTWF0aC5QSSAvIDE4MDtcbiAgICAgIHZhciBjYXRlc2lhbkNvb3JkID0gdGhpcy5zcGhlcmljYWxUb0NhcnRlc2lhbihhemltdXRoUmFkaWFucywgZWxldmF0aW9uUmFkaWFucywgaHJ0Zi5kaXN0YW5jZSk7XG4gICAgICBocnRmLnggPSBjYXRlc2lhbkNvb3JkLng7XG4gICAgICBocnRmLnkgPSBjYXRlc2lhbkNvb3JkLnk7XG4gICAgICBocnRmLnogPSBjYXRlc2lhbkNvb3JkLno7XG4gICAgfVxuICAgIHRoaXMudHJlZSA9IGtkdC5jcmVhdGVLZFRyZWUodGhpcy5ocnRmRGF0YXNldCwgdGhpcy5kaXN0YW5jZSwgWyd4JywgJ3knLCAneiddKTtcblxuICAgIC8vIFB1dCBkZWZhdWx0IHZhbHVlc1xuICAgIHZhciBocnRmTmV4dFBvc2l0aW9uID0gdGhpcy5nZXRIUlRGKDAsIDAsIDEpO1xuICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5zZXRDb2VmZmljaWVudHMoaHJ0Zk5leHRQb3NpdGlvbi5paXJfY29lZmZzX2xlZnQsIGhydGZOZXh0UG9zaXRpb24uaWlyX2NvZWZmc19yaWdodCk7XG4gICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLnNldERlbGF5KGhydGZOZXh0UG9zaXRpb24uaXRkIC8gMTAwMCk7XG4gICAgdGhpcy5tYWluQXVkaW9HcmFwaC5zZXRDb2VmZmljaWVudHMoaHJ0Zk5leHRQb3NpdGlvbi5paXJfY29lZmZzX2xlZnQsIGhydGZOZXh0UG9zaXRpb24uaWlyX2NvZWZmc19yaWdodCk7XG4gICAgdGhpcy5tYWluQXVkaW9HcmFwaC5zZXREZWxheShocnRmTmV4dFBvc2l0aW9uLml0ZCAvIDEwMDApO1xuICB9XG4gIGdldCBIUlRGRGF0YXNldCgpIHtcbiAgICByZXR1cm4gdGhpcy5ocnRmRGF0YXNldDtcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxjdWxhdGUgdGhlIGRpc3RhbmNlIGJldHdlZW4gdHdvIHBvaW50cyBpbiBhIDMtRCBzcGFjZS5cbiAgICogQHByaXZhdGVcbiAgICogQGNoYWluYWJsZVxuICAgKiBAcGFyYW0gYSBPYmplY3QgY29udGFpbmluZyB0aHJlZSBwcm9wZXJ0aWVzOiB4LCB5LCB6XG4gICAqIEBwYXJhbSBiIE9iamVjdCBjb250YWluaW5nIHRocmVlIHByb3BlcnRpZXM6IHgsIHksIHpcbiAgICovXG4gIGRpc3RhbmNlKGEsIGIpIHtcbiAgICAvLyBObyBuZWVkIHRvIGNvbXB1dGUgc3F1YXJlIHJvb3QgaGVyZSBmb3IgZGlzdGFuY2UgY29tcGFyaXNvbiwgdGhpcyBpcyBtb3JlIGVmaWNpZW50LlxuICAgIHJldHVybiBNYXRoLnBvdyhhLnggLSBiLngsIDIpICsgTWF0aC5wb3coYS55IC0gYi55LCAyKSArIE1hdGgucG93KGEueiAtIGIueiwgMik7XG4gIH1cblxuICAvKipcbiAgICogU2V0IGdhaW4gdmFsdWUgYW5kIHNxdWFyZWQgdm9sdW1lLlxuICAgKiBAcHJpdmF0ZVxuICAgKiBAY2hhaW5hYmxlXG4gICAqIEB0b2RvIDogcmVhbG1lbnQgdmEgYXF1w60gYWl4w7I/XG4gICAqL1xuICBzZXRMYXN0UG9zaXRpb24oKSB7XG4gICAgaWYgKCF0aGlzLmlzQ3Jvc3NmYWRpbmcoKSkge1xuICAgICAgdGhpcy5jaGFuZ2VXaGVuRmluaXNoQ3Jvc3NmYWRpbmcgPSBmYWxzZTtcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5pbnRlcnZhbElEKTtcbiAgICAgIHRoaXMucmVhbGx5U3RhcnRQb3NpdGlvbigpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDcm9zc2ZhZGluZ1xuICAgKiBAcHJpdmF0ZVxuICAgKiBAY2hhaW5hYmxlXG4gICAqL1xuICBjcm9zc2ZhZGluZygpIHtcbiAgICAvLyBEbyB0aGUgY3Jvc3NmYWRpbmcgYmV0d2VlbiBtYWluQXVkaW9HcmFwaCBhbmQgc2Vjb25kYXJ5QXVkaW9HcmFwaFxuICAgIHZhciBub3cgPSB0aGlzLmF1ZGlvQ29udGV4dC5jdXJyZW50VGltZTtcbiAgICAvLyBXYWl0IHR3byBidWZmZXJzIHVudGlsIGRvIHRoZSBjaGFuZ2UgKHNjcmlwdFByb2Nlc3Nvck5vZGUgb25seSB1cGRhdGUgdGhlIHZhcmlhYmxlcyBhdCB0aGUgZmlyc3Qgc2FtcGxlIG9mIHRoZSBidWZmZXIpXG4gICAgdGhpcy5tYWluQXVkaW9HcmFwaC5nYWluLnNldFZhbHVlQXRUaW1lKDEsIG5vdyArIDIgKiB0aGlzLmJ1ZmZlclNpemUgLyB0aGlzLnNhbXBsZVJhdGUpO1xuICAgIHRoaXMubWFpbkF1ZGlvR3JhcGguZ2Fpbi5saW5lYXJSYW1wVG9WYWx1ZUF0VGltZSgwLCBub3cgKyB0aGlzLmNyb3NzZmFkZUR1cmF0aW9uICsgMiAqIHRoaXMuYnVmZmVyU2l6ZSAvIHRoaXMuc2FtcGxlUmF0ZSk7XG5cbiAgICB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguZ2Fpbi5zZXRWYWx1ZUF0VGltZSgwLCBub3cgKyAyICogdGhpcy5idWZmZXJTaXplIC8gdGhpcy5zYW1wbGVSYXRlKTtcbiAgICB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguZ2Fpbi5saW5lYXJSYW1wVG9WYWx1ZUF0VGltZSgxLCBub3cgKyB0aGlzLmNyb3NzZmFkZUR1cmF0aW9uICsgMiAqIHRoaXMuYnVmZmVyU2l6ZSAvIHRoaXMuc2FtcGxlUmF0ZSk7XG4gIH1cblxuICAvKipcbiAgICogU2V0IHBvc2l0aW9uIG9mIHRoZSB2aXJ0dWFsIHNvdXJjZVxuICAgKiBAcHVibGljXG4gICAqIEBjaGFpbmFibGVcbiAgICogQHBhcmFtIGF6aW11dGggQXppbXV0aCBpbiBkZWdyZWVzICjCsCk6IGZyb20gMCB0byAtMTgwIGZvciBzb3VyY2Ugb24geW91ciBsZWZ0LCBhbmQgZnJvbSAwIHRvIDE4MCBmb3Igc291cmNlIG9uIHlvdXIgcmlnaHRcbiAgICogQHBhcmFtIGVsZXZhdGlvbiBFbGV2YXRpb24gaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gOTAgZm9yIHNvdXJjZSBhYm92ZSB5b3VyIGhlYWQsIDAgZm9yIHNvdXJjZSBpbiBmcm9udCBvZiB5b3VyIGhlYWQsIGFuZCBmcm9tIDAgdG8gLTkwIGZvciBzb3VyY2UgYmVsb3cgeW91ciBoZWFkKVxuICAgKiBAcGFyYW0gZGlzdGFuY2UgRGlzdGFuY2UgaW4gbWV0ZXJzXG4gICAqL1xuICBzZXRQb3NpdGlvbihhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKSB7XG5cbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMykge1xuICAgICAgLy8gQ2FsY3VsYXRlIHRoZSBuZWFyZXN0IHBvc2l0aW9uIGZvciB0aGUgaW5wdXQgYXppbXV0aCwgZWxldmF0aW9uIGFuZCBkaXN0YW5jZVxuICAgICAgdmFyIG5lYXJlc3RQb3NpdGlvbiA9IHRoaXMuZ2V0UmVhbENvb3JkaW5hdGVzKGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpO1xuICAgICAgLy8gTm8gbmVlZCB0byBjaGFuZ2UgdGhlIGN1cnJlbnQgSFJURiBsb2FkZWQgaWYgc2V0dGVkIHBvc2l0aW9uIGVxdWFsIGN1cnJlbnQgcG9zaXRpb25cbiAgICAgIGlmIChuZWFyZXN0UG9zaXRpb24uYXppbXV0aCAhPT0gdGhpcy5wb3NpdGlvbi5hemltdXRoIHx8IG5lYXJlc3RQb3NpdGlvbi5lbGV2YXRpb24gIT09IHRoaXMucG9zaXRpb24uZWxldmF0aW9uIHx8IG5lYXJlc3RQb3NpdGlvbi5kaXN0YW5jZSAhPT0gdGhpcy5wb3NpdGlvbi5kaXN0YW5jZSkge1xuICAgICAgICAvLyBDaGVjayBpZiB0aGUgY3Jvc3NmYWRpbmcgaXMgYWN0aXZlXG4gICAgICAgIGlmICh0aGlzLmlzQ3Jvc3NmYWRpbmcoKSA9PT0gdHJ1ZSkge1xuICAgICAgICAgIC8vIENoZWNrIGlmIHRoZXJlIGlzIGEgdmFsdWUgd2FpdGluZyB0byBiZSBzZXRcbiAgICAgICAgICBpZiAodGhpcy5jaGFuZ2VXaGVuRmluaXNoQ3Jvc3NmYWRpbmcgPT09IHRydWUpIHtcbiAgICAgICAgICAgIC8vIFN0b3AgdGhlIHBhc3Qgc2V0SW50ZXJ2YWwgZXZlbnQuXG4gICAgICAgICAgICBjbGVhckludGVydmFsKHRoaXMuaW50ZXJ2YWxJRCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuY2hhbmdlV2hlbkZpbmlzaENyb3NzZmFkaW5nID0gdHJ1ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBTYXZlIHRoZSBwb3NpdGlvblxuICAgICAgICAgIHRoaXMubmV4dFBvc2l0aW9uLmF6aW11dGggPSBuZWFyZXN0UG9zaXRpb24uYXppbXV0aDtcbiAgICAgICAgICB0aGlzLm5leHRQb3NpdGlvbi5lbGV2YXRpb24gPSBuZWFyZXN0UG9zaXRpb24uZWxldmF0aW9uO1xuICAgICAgICAgIHRoaXMubmV4dFBvc2l0aW9uLmRpc3RhbmNlID0gbmVhcmVzdFBvc2l0aW9uLmRpc3RhbmNlO1xuXG4gICAgICAgICAgLy8gU3RhcnQgdGhlIHNldEludGVydmFsOiB3YWl0IHVudGlsIHRoZSBjcm9zc2ZhZGluZyBpcyBmaW5pc2hlZC5cbiAgICAgICAgICB0aGlzLmludGVydmFsSUQgPSB3aW5kb3cuc2V0SW50ZXJ2YWwodGhpcy5zZXRMYXN0UG9zaXRpb24uYmluZCh0aGlzKSwgMC4wMDUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMubmV4dFBvc2l0aW9uLmF6aW11dGggPSBuZWFyZXN0UG9zaXRpb24uYXppbXV0aDtcbiAgICAgICAgICB0aGlzLm5leHRQb3NpdGlvbi5lbGV2YXRpb24gPSBuZWFyZXN0UG9zaXRpb24uZWxldmF0aW9uO1xuICAgICAgICAgIHRoaXMubmV4dFBvc2l0aW9uLmRpc3RhbmNlID0gbmVhcmVzdFBvc2l0aW9uLmRpc3RhbmNlO1xuICAgICAgICAgIHRoaXMucmVhbGx5U3RhcnRQb3NpdGlvbigpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzOyAvLyBGb3IgY2hhaW5hYmlsaXR5XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWxseSBjaGFuZ2UgdGhlIHBvc2l0aW9uXG4gICAqIEBwcml2YXRlXG4gICAqL1xuICByZWFsbHlTdGFydFBvc2l0aW9uKCkge1xuICAgIC8vIFNhdmUgdGhlIGN1cnJlbnQgcG9zaXRpb25cbiAgICB0aGlzLnBvc2l0aW9uLmF6aW11dGggPSB0aGlzLm5leHRQb3NpdGlvbi5hemltdXRoO1xuICAgIHRoaXMucG9zaXRpb24uZWxldmF0aW9uID0gdGhpcy5uZXh0UG9zaXRpb24uZWxldmF0aW9uO1xuICAgIHRoaXMucG9zaXRpb24uZGlzdGFuY2UgPSB0aGlzLm5leHRQb3NpdGlvbi5kaXN0YW5jZTtcblxuICAgIHZhciBocnRmTmV4dFBvc2l0aW9uID0gdGhpcy5nZXRIUlRGKHRoaXMucG9zaXRpb24uYXppbXV0aCwgdGhpcy5wb3NpdGlvbi5lbGV2YXRpb24sIHRoaXMucG9zaXRpb24uZGlzdGFuY2UpO1xuICAgIC8vIExvYWQgdGhlIG5ldyBwb3NpdGlvbiBpbiB0aGUgYmlxdWFkIGFuZCBkZWxheSBub3QgYWN0aXZlIChzZWNvbmRhcnlBdWRpb0dyYXBoKVxuICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5zZXRDb2VmZmljaWVudHMoaHJ0Zk5leHRQb3NpdGlvbi5paXJfY29lZmZzX2xlZnQsIGhydGZOZXh0UG9zaXRpb24uaWlyX2NvZWZmc19yaWdodCk7XG4gICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLnNldERlbGF5KGhydGZOZXh0UG9zaXRpb24uaXRkIC8gMTAwMCk7XG5cbiAgICAvLyBEbyB0aGUgY3Jvc3NmYWRpbmcgYmV0d2VlbiBtYWluQXVkaW9HcmFwaCBhbmQgc2Vjb25kYXJ5QXVkaW9HcmFwaFxuICAgIHRoaXMuY3Jvc3NmYWRpbmcoKTtcblxuICAgIC8vIENoYW5nZSBjdXJyZW50IG1haW5BdWRpb0dyYXBoXG4gICAgdmFyIGFjdGl2ZSA9IHRoaXMubWFpbkF1ZGlvR3JhcGg7XG4gICAgdGhpcy5tYWluQXVkaW9HcmFwaCA9IHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaDtcbiAgICB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGggPSBhY3RpdmU7XG4gIH1cblxuICAvKipcbiAgICogR2V0IHRoZSBjdXJyZW50IHBvc2l0aW9uIG9mIHRoZSB2aXJ0dWFsIHNvdXJjZS5cbiAgICogQHB1YmxpY1xuICAgKi9cbiAgZ2V0UG9zaXRpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMucG9zaXRpb247XG4gIH1cblxuICAvKipcbiAgICogUGF1c2UgcGxheWluZy5cbiAgICogQHB1YmxpY1xuICAgKi9cbiAgc2V0Q3Jvc3NmYWRlRHVyYXRpb24obXNSYW1wKSB7XG4gICAgLy9zYXZlIGluIHNlY29uZHNcbiAgICB0aGlzLmNyb3NzZmFkZUR1cmF0aW9uID0gbXNSYW1wIC8gMTAwMDtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZWVrIGJ1ZmZlciBwb3NpdGlvbiAoaW4gc2VjKS5cbiAgICogQHB1YmxpY1xuICAgKi9cbiAgZ2V0Q3Jvc3NmYWRlRHVyYXRpb24oKSB7XG4gICAgLy9yZXR1cm4gaW4gbXNcbiAgICByZXR1cm4gdGhpcy5jcm9zc2ZhZGVEdXJhdGlvbiAqIDEwMDA7XG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZSBwbGF5aW5nIGZsYWcgd2hlbiB0aGUgZW5kIG9mIHRoZSBidWZmZXIgaXMgcmVhY2hlZC5cbiAgICogQHB1YmxpY1xuICAgKiBAdG9kbyBIYW5kbGUgc3BlZWQgY2hhbmdlcy5cbiAgICovXG4gIGlzQ3Jvc3NmYWRpbmcoKSB7XG4gICAgLy8gVGhlIHJhbXBzIGFyZSBub3QgZmluaXNoZWQsIHNvIHRoZSBjcm9zc2ZhZGluZyBpcyBub3QgZmluaXNoZWRcbiAgICBpZiAodGhpcy5tYWluQXVkaW9HcmFwaC5nYWluLnZhbHVlICE9PSAxKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIEhSVEYgZmlsZSBmb3IgYW4gZXNwZWNpZmljIHBvc2l0aW9uXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSBhemltdXRoIEF6aW11dGggaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gLTE4MCBmb3Igc291cmNlIG9uIHlvdXIgbGVmdCwgYW5kIGZyb20gMCB0byAxODAgZm9yIHNvdXJjZSBvbiB5b3VyIHJpZ2h0XG4gICAqIEBwYXJhbSBlbGV2YXRpb24gRWxldmF0aW9uIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIDkwIGZvciBzb3VyY2UgYWJvdmUgeW91ciBoZWFkLCAwIGZvciBzb3VyY2UgaW4gZnJvbnQgb2YgeW91ciBoZWFkLCBhbmQgZnJvbSAwIHRvIC05MCBmb3Igc291cmNlIGJlbG93IHlvdXIgaGVhZClcbiAgICogQHBhcmFtIGRpc3RhbmNlIERpc3RhbmNlIGluIG1ldGVyc1xuICAgKi9cbiAgZ2V0SFJURihhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKSB7XG4gICAgdmFyIG5lYXJlc3QgPSB0aGlzLmdldE5lYXJlc3RQb2ludChhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKTtcbiAgICB2YXIgaHJ0ZiA9IFtdO1xuICAgIGhydGYuaWlyX2NvZWZmc19sZWZ0ID0gbmVhcmVzdC5paXJfY29lZmZzX2xlZnQ7XG4gICAgaHJ0Zi5paXJfY29lZmZzX3JpZ2h0ID0gbmVhcmVzdC5paXJfY29lZmZzX3JpZ2h0O1xuICAgIGhydGYuaXRkID0gbmVhcmVzdC5pdGQ7XG5cbiAgICAvLyBSZXR1cm4gaHJ0ZiBkYXRhIG9mIG5lYXJlc3QgcG9zaXRpb24gZm9yIHRoZSBpbnB1dCB2YWx1ZXNcbiAgICByZXR1cm4gaHJ0ZjtcbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFuc2Zvcm0gdGhlIHNwaGVyaWNhbCB0byBjYXJ0ZXNpYW4gY29vcmRpbmF0ZXMuXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSBhemltdXRoIEF6aW11dGggaW4gcmFkaWFuc1xuICAgKiBAcGFyYW0gZWxldmF0aW9uIEVsZXZhdGlvbiBpbiByYWRpYW5zXG4gICAqIEBwYXJhbSBkaXN0YW5jZSBEaXN0YW5jZSBpbiBtZXRlcnNcbiAgICovXG4gIHNwaGVyaWNhbFRvQ2FydGVzaWFuKGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpIHtcbiAgICByZXR1cm4ge1xuICAgICAgeDogZGlzdGFuY2UgKiBNYXRoLnNpbihhemltdXRoKSxcbiAgICAgIHk6IGRpc3RhbmNlICogTWF0aC5jb3MoYXppbXV0aCksXG4gICAgICB6OiBkaXN0YW5jZSAqIE1hdGguc2luKGVsZXZhdGlvbilcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgbmVhcmVzdCBwb3NpdGlvbiBmb3IgYW4gaW5wdXQgcG9zaXRpb24uXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSBhemltdXRoIEF6aW11dGggaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gLTE4MCBmb3Igc291cmNlIG9uIHlvdXIgbGVmdCwgYW5kIGZyb20gMCB0byAxODAgZm9yIHNvdXJjZSBvbiB5b3VyIHJpZ2h0XG4gICAqIEBwYXJhbSBlbGV2YXRpb24gRWxldmF0aW9uIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIDkwIGZvciBzb3VyY2UgYWJvdmUgeW91ciBoZWFkLCAwIGZvciBzb3VyY2UgaW4gZnJvbnQgb2YgeW91ciBoZWFkLCBhbmQgZnJvbSAwIHRvIC05MCBmb3Igc291cmNlIGJlbG93IHlvdXIgaGVhZClcbiAgICogQHBhcmFtIGRpc3RhbmNlIERpc3RhbmNlIGluIG1ldGVyc1xuICAgKi9cbiAgZ2V0UmVhbENvb3JkaW5hdGVzKGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpIHtcbiAgICB2YXIgbmVhcmVzdCA9IHRoaXMuZ2V0TmVhcmVzdFBvaW50KGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpO1xuICAgIC8vIFJldHVybiBhemltdXRoLCBlbGV2YXRpb24gYW5kIGRpc3RhbmNlIG9mIG5lYXJlc3QgcG9zaXRpb24gZm9yIHRoZSBpbnB1dCB2YWx1ZXNcbiAgICByZXR1cm4ge1xuICAgICAgYXppbXV0aDogbmVhcmVzdC5hemltdXRoLFxuICAgICAgZWxldmF0aW9uOiBuZWFyZXN0LmVsZXZhdGlvbixcbiAgICAgIGRpc3RhbmNlOiBuZWFyZXN0LmRpc3RhbmNlXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIG5lYXJlc3QgcG9zaXRpb24gZm9yIGFuIGlucHV0IHBvc2l0aW9uLlxuICAgKiBAcHJpdmF0ZVxuICAgKiBAcGFyYW0gYXppbXV0aCBBemltdXRoIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIC0xODAgZm9yIHNvdXJjZSBvbiB5b3VyIGxlZnQsIGFuZCBmcm9tIDAgdG8gMTgwIGZvciBzb3VyY2Ugb24geW91ciByaWdodFxuICAgKiBAcGFyYW0gZWxldmF0aW9uIEVsZXZhdGlvbiBpbiBkZWdyZWVzICjCsCk6IGZyb20gMCB0byA5MCBmb3Igc291cmNlIGFib3ZlIHlvdXIgaGVhZCwgMCBmb3Igc291cmNlIGluIGZyb250IG9mIHlvdXIgaGVhZCwgYW5kIGZyb20gMCB0byAtOTAgZm9yIHNvdXJjZSBiZWxvdyB5b3VyIGhlYWQpXG4gICAqIEBwYXJhbSBkaXN0YW5jZSBEaXN0YW5jZSBpbiBtZXRlcnNcbiAgICovXG4gIGdldE5lYXJlc3RQb2ludChhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKSB7XG4gICAgLy8gRGVncmVlcyB0byByYWRpYW5zIGZvciB0aGUgYXppbXV0aCBhbmQgZWxldmF0aW9uXG4gICAgdmFyIGF6aW11dGhSYWRpYW5zID0gYXppbXV0aCAqIE1hdGguUEkgLyAxODA7XG4gICAgdmFyIGVsZXZhdGlvblJhZGlhbnMgPSBlbGV2YXRpb24gKiBNYXRoLlBJIC8gMTgwO1xuICAgIC8vIENvbnZlcnQgc3BoZXJpY2FsIGNvb3JkaW5hdGVzIHRvIGNhcnRlc2lhblxuICAgIHZhciBjYXJ0ZXNpYW5Db29yZCA9IHRoaXMuc3BoZXJpY2FsVG9DYXJ0ZXNpYW4oYXppbXV0aFJhZGlhbnMsIGVsZXZhdGlvblJhZGlhbnMsIGRpc3RhbmNlKTtcbiAgICAvLyBHZXQgdGhlIG5lYXJlc3QgSFJURiBmaWxlIGZvciB0aGUgZGVzaXJlZCBwb3NpdGlvblxuICAgIHZhciBuZWFyZXN0ID0gdGhpcy50cmVlLm5lYXJlc3QoY2FydGVzaWFuQ29vcmQsIDEpWzBdO1xuXG4gICAgcmV0dXJuIG5lYXJlc3RbMF07XG4gIH1cbn1cblxuXG4vKipcbiAqIEF1ZGlvR3JhcGggc3ViIGF1ZGlvIGdyYXBoIG9iamVjdCBhcyBhbiBFQ01BU2NyaXB0NSBwcm9wZXJ0aWVzIG9iamVjdC5cbiAqL1xuY2xhc3MgUHJvY2Vzc2luZ0F1ZGlvR3JhcGgge1xuICBjb25zdHJ1Y3RvcihvcHRpb25zKSB7XG4gICAgdGhpcy5hdWRpb0NvbnRleHQgPSBvcHRpb25zLmF1ZGlvQ29udGV4dDtcbiAgICAvLyBQcml2YXRlIHByb3BlcnRpZXNcbiAgICB0aGlzLmJ1ZmZlclNpemUgPSAxMDI0O1xuXG4gICAgLy8gQ3JlYXRpb25zXG4gICAgdGhpcy5pbnB1dCA9IHRoaXMuYXVkaW9Db250ZXh0LmNyZWF0ZUdhaW4oKTtcbiAgICB0aGlzLmdhaW5Ob2RlID0gdGhpcy5hdWRpb0NvbnRleHQuY3JlYXRlR2FpbigpO1xuICAgIHRoaXMuYmlxdWFkRmlsdGVyTGVmdCA9IG5ldyBCaXF1YWRGaWx0ZXIoKTtcbiAgICB0aGlzLmJpcXVhZEZpbHRlclJpZ2h0ID0gbmV3IEJpcXVhZEZpbHRlcigpO1xuICAgIHRoaXMuZnJhY3Rpb25hbERlbGF5TGVmdCA9IG5ldyBGcmFjdGlvbmFsRGVsYXkoNDQxMDApO1xuICAgIHRoaXMuZnJhY3Rpb25hbERlbGF5UmlnaHQgPSBuZXcgRnJhY3Rpb25hbERlbGF5KDQ0MTAwKTtcbiAgICB0aGlzLnByb2Nlc3Nvck5vZGUgPSB0aGlzLmF1ZGlvQ29udGV4dC5jcmVhdGVTY3JpcHRQcm9jZXNzb3IodGhpcy5idWZmZXJTaXplKTtcbiAgICAvLyBDb25uZWN0aW9uc1xuICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLnByb2Nlc3Nvck5vZGUpO1xuICAgIHRoaXMucHJvY2Vzc29yTm9kZS5jb25uZWN0KHRoaXMuZ2Fpbk5vZGUpO1xuICAgIC8vIFN0YXJ0IHByb2Nlc3Nvck5vZGVcbiAgICB0aGlzLnByb2Nlc3Nvck5vZGVGdW5jdGlvbigpO1xuICB9XG5cbiAgZ2V0IGdhaW4oKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2Fpbk5vZGUuZ2FpbjtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXQgY29lZmZpY2llbnRzIGJpcXVhZCBmaWx0ZXJcbiAgICogQHB1YmxpY1xuICAgKiBAcGFyYW0gdmFsdWUgQXVkaW9CdWZmZXIgT2JqZWN0LlxuICAgKi9cbiAgc2V0Q29lZmZpY2llbnRzKGxlZnRDb2VmZmljaWVudHMsIHJpZ2h0Q29lZmZpY2llbnRzKSB7XG4gICAgdGhpcy5iaXF1YWRGaWx0ZXJMZWZ0LnNldENvZWZmaWNpZW50cyhsZWZ0Q29lZmZpY2llbnRzKTtcbiAgICB0aGlzLmJpcXVhZEZpbHRlclJpZ2h0LnNldENvZWZmaWNpZW50cyhyaWdodENvZWZmaWNpZW50cyk7XG4gIH1cblxuICAvKipcbiAgICogU2V0IGJ1ZmZlciBhbmQgYnVmZmVyRHVyYXRpb24uXG4gICAqIEBwdWJsaWNcbiAgICogQGNoYWluYWJsZVxuICAgKi9cbiAgc2V0RGVsYXkoZGVsYXkpIHtcbiAgICB2YXIgZGVsYXlMZWZ0ID0gMSAvIDEwMDAgKyBkZWxheSAvIDI7XG4gICAgdmFyIGRlbGF5UmlnaHQgPSAxIC8gMTAwMCAtIGRlbGF5IC8gMjtcbiAgICB0aGlzLmZyYWN0aW9uYWxEZWxheUxlZnQuc2V0RGVsYXkoZGVsYXlMZWZ0KTtcbiAgICB0aGlzLmZyYWN0aW9uYWxEZWxheVJpZ2h0LnNldERlbGF5KGRlbGF5UmlnaHQpO1xuICB9XG5cbiAgcHJvY2Vzc29yTm9kZUZ1bmN0aW9uKCkge1xuICAgIHZhciB0aGF0ID0gdGhpcztcbiAgICB0aGlzLnByb2Nlc3Nvck5vZGUub25hdWRpb3Byb2Nlc3MgPSBmdW5jdGlvbihlKSB7XG4gICAgICAvLyBHZXQgdGhlIGlucHV0QnVmZmVyXG4gICAgICB2YXIgaW5wdXRBcnJheSA9IGUuaW5wdXRCdWZmZXIuZ2V0Q2hhbm5lbERhdGEoMCk7XG5cbiAgICAgIC8vIEdldCB0aGUgb3V0cHV0QnVmZmVyc1xuICAgICAgdmFyIGxlZnRPdXRwdXRBcnJheSA9IGUub3V0cHV0QnVmZmVyLmdldENoYW5uZWxEYXRhKDApO1xuICAgICAgdmFyIHJpZ2h0T3V0cHV0QXJyYXkgPSBlLm91dHB1dEJ1ZmZlci5nZXRDaGFubmVsRGF0YSgxKTtcblxuICAgICAgLy8gRGVsYXlcbiAgICAgIHZhciBtZWRpdW1BcnJheUxlZnQgPSBuZXcgRmxvYXQzMkFycmF5KHRoYXQuZnJhY3Rpb25hbERlbGF5TGVmdC5wcm9jZXNzKGlucHV0QXJyYXkpKTtcbiAgICAgIHZhciBtZWRpdW1BcnJheVJpZ2h0ID0gbmV3IEZsb2F0MzJBcnJheSh0aGF0LmZyYWN0aW9uYWxEZWxheVJpZ2h0LnByb2Nlc3MoaW5wdXRBcnJheSkpO1xuXG4gICAgICAvLyBCaXF1YWRGaWx0ZXJcbiAgICAgIHRoYXQuYmlxdWFkRmlsdGVyTGVmdC5wcm9jZXNzKG1lZGl1bUFycmF5TGVmdCwgbGVmdE91dHB1dEFycmF5KTtcbiAgICAgIHRoYXQuYmlxdWFkRmlsdGVyUmlnaHQucHJvY2VzcyhtZWRpdW1BcnJheVJpZ2h0LCByaWdodE91dHB1dEFycmF5KTtcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIENvbm5lY3QgdGhlIGNvbnZvbHZlckF1ZGlvR3JhcGggdG8gYSBub2RlXG4gICAqIEBwdWJsaWNcbiAgICogQGNoYWluYWJsZVxuICAgKiBAcGFyYW0gbm9kZSBEZXN0aW5hdGlvbiBub2RlXG4gICAqL1xuICBjb25uZWN0KG5vZGUpIHtcbiAgICB0aGlzLmdhaW5Ob2RlLmNvbm5lY3Qobm9kZSk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogRGlzY29ubmVjdCB0aGUgY29udm9sdmVyQXVkaW9HcmFwaCB0byBhIG5vZGVcbiAgICogQHB1YmxpY1xuICAgKiBAY2hhaW5hYmxlXG4gICAqIEBwYXJhbSBub2RlIERlc3RpbmF0aW9uIG5vZGVcbiAgICovXG4gIGRpc2Nvbm5lY3Qobm9kZSkge1xuICAgIHRoaXMuZ2Fpbk5vZGUuZGlzY29ubmVjdChub2RlKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxufVxuIiwibW9kdWxlLmV4cG9ydHMgPSB7IFwiZGVmYXVsdFwiOiByZXF1aXJlKFwiY29yZS1qcy9saWJyYXJ5L2ZuL29iamVjdC9kZWZpbmUtcHJvcGVydHlcIiksIF9fZXNNb2R1bGU6IHRydWUgfTsiLCJcInVzZSBzdHJpY3RcIjtcblxuZXhwb3J0c1tcImRlZmF1bHRcIl0gPSBmdW5jdGlvbiAoaW5zdGFuY2UsIENvbnN0cnVjdG9yKSB7XG4gIGlmICghKGluc3RhbmNlIGluc3RhbmNlb2YgQ29uc3RydWN0b3IpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkNhbm5vdCBjYWxsIGEgY2xhc3MgYXMgYSBmdW5jdGlvblwiKTtcbiAgfVxufTtcblxuZXhwb3J0cy5fX2VzTW9kdWxlID0gdHJ1ZTsiLCJcInVzZSBzdHJpY3RcIjtcblxudmFyIF9PYmplY3QkZGVmaW5lUHJvcGVydHkgPSByZXF1aXJlKFwiYmFiZWwtcnVudGltZS9jb3JlLWpzL29iamVjdC9kZWZpbmUtcHJvcGVydHlcIilbXCJkZWZhdWx0XCJdO1xuXG5leHBvcnRzW1wiZGVmYXVsdFwiXSA9IChmdW5jdGlvbiAoKSB7XG4gIGZ1bmN0aW9uIGRlZmluZVByb3BlcnRpZXModGFyZ2V0LCBwcm9wcykge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcHJvcHMubGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciBkZXNjcmlwdG9yID0gcHJvcHNbaV07XG4gICAgICBkZXNjcmlwdG9yLmVudW1lcmFibGUgPSBkZXNjcmlwdG9yLmVudW1lcmFibGUgfHwgZmFsc2U7XG4gICAgICBkZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSA9IHRydWU7XG4gICAgICBpZiAoXCJ2YWx1ZVwiIGluIGRlc2NyaXB0b3IpIGRlc2NyaXB0b3Iud3JpdGFibGUgPSB0cnVlO1xuXG4gICAgICBfT2JqZWN0JGRlZmluZVByb3BlcnR5KHRhcmdldCwgZGVzY3JpcHRvci5rZXksIGRlc2NyaXB0b3IpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBmdW5jdGlvbiAoQ29uc3RydWN0b3IsIHByb3RvUHJvcHMsIHN0YXRpY1Byb3BzKSB7XG4gICAgaWYgKHByb3RvUHJvcHMpIGRlZmluZVByb3BlcnRpZXMoQ29uc3RydWN0b3IucHJvdG90eXBlLCBwcm90b1Byb3BzKTtcbiAgICBpZiAoc3RhdGljUHJvcHMpIGRlZmluZVByb3BlcnRpZXMoQ29uc3RydWN0b3IsIHN0YXRpY1Byb3BzKTtcbiAgICByZXR1cm4gQ29uc3RydWN0b3I7XG4gIH07XG59KSgpO1xuXG5leHBvcnRzLl9fZXNNb2R1bGUgPSB0cnVlOyIsIlwidXNlIHN0cmljdFwiO1xuXG5leHBvcnRzW1wiZGVmYXVsdFwiXSA9IGZ1bmN0aW9uIChvYmopIHtcbiAgcmV0dXJuIG9iaiAmJiBvYmouX19lc01vZHVsZSA/IG9iaiA6IHtcbiAgICBcImRlZmF1bHRcIjogb2JqXG4gIH07XG59O1xuXG5leHBvcnRzLl9fZXNNb2R1bGUgPSB0cnVlOyIsInZhciAkID0gcmVxdWlyZSgnLi4vLi4vbW9kdWxlcy8kJyk7XG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGRlZmluZVByb3BlcnR5KGl0LCBrZXksIGRlc2Mpe1xuICByZXR1cm4gJC5zZXREZXNjKGl0LCBrZXksIGRlc2MpO1xufTsiLCJ2YXIgJE9iamVjdCA9IE9iamVjdDtcbm1vZHVsZS5leHBvcnRzID0ge1xuICBjcmVhdGU6ICAgICAkT2JqZWN0LmNyZWF0ZSxcbiAgZ2V0UHJvdG86ICAgJE9iamVjdC5nZXRQcm90b3R5cGVPZixcbiAgaXNFbnVtOiAgICAge30ucHJvcGVydHlJc0VudW1lcmFibGUsXG4gIGdldERlc2M6ICAgICRPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yLFxuICBzZXREZXNjOiAgICAkT2JqZWN0LmRlZmluZVByb3BlcnR5LFxuICBzZXREZXNjczogICAkT2JqZWN0LmRlZmluZVByb3BlcnRpZXMsXG4gIGdldEtleXM6ICAgICRPYmplY3Qua2V5cyxcbiAgZ2V0TmFtZXM6ICAgJE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzLFxuICBnZXRTeW1ib2xzOiAkT2JqZWN0LmdldE93blByb3BlcnR5U3ltYm9scyxcbiAgZWFjaDogICAgICAgW10uZm9yRWFjaFxufTsiLCIvKipcbiAqIEFVVEhPUiBPRiBJTklUSUFMIEpTIExJQlJBUllcbiAqIGstZCBUcmVlIEphdmFTY3JpcHQgLSBWIDEuMFxuICpcbiAqIGh0dHBzOi8vZ2l0aHViLmNvbS91YmlsYWJzL2tkLXRyZWUtamF2YXNjcmlwdFxuICpcbiAqIEBhdXRob3IgTWlyY2VhIFByaWNvcCA8cHJpY29wQHViaWxhYnMubmV0PiwgMjAxMlxuICogQGF1dGhvciBNYXJ0aW4gS2xlcHBlIDxrbGVwcGVAdWJpbGFicy5uZXQ+LCAyMDEyXG4gKiBAYXV0aG9yIFViaWxhYnMgaHR0cDovL3ViaWxhYnMubmV0LCAyMDEyXG4gKiBAbGljZW5zZSBNSVQgTGljZW5zZSA8aHR0cDovL3d3dy5vcGVuc291cmNlLm9yZy9saWNlbnNlcy9taXQtbGljZW5zZS5waHA+XG4gKi9cblxuXG5mdW5jdGlvbiBOb2RlKG9iaiwgZGltZW5zaW9uLCBwYXJlbnQpIHtcbiAgdGhpcy5vYmogPSBvYmo7XG4gIHRoaXMubGVmdCA9IG51bGw7XG4gIHRoaXMucmlnaHQgPSBudWxsO1xuICB0aGlzLnBhcmVudCA9IHBhcmVudDtcbiAgdGhpcy5kaW1lbnNpb24gPSBkaW1lbnNpb247XG59XG5cbmZ1bmN0aW9uIEtkVHJlZShwb2ludHMsIG1ldHJpYywgZGltZW5zaW9ucykge1xuXG4gIHZhciBzZWxmID0gdGhpcztcbiAgXG4gIGZ1bmN0aW9uIGJ1aWxkVHJlZShwb2ludHMsIGRlcHRoLCBwYXJlbnQpIHtcbiAgICB2YXIgZGltID0gZGVwdGggJSBkaW1lbnNpb25zLmxlbmd0aCxcbiAgICAgIG1lZGlhbixcbiAgICAgIG5vZGU7XG5cbiAgICBpZiAocG9pbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGlmIChwb2ludHMubGVuZ3RoID09PSAxKSB7XG4gICAgICByZXR1cm4gbmV3IE5vZGUocG9pbnRzWzBdLCBkaW0sIHBhcmVudCk7XG4gICAgfVxuXG4gICAgcG9pbnRzLnNvcnQoZnVuY3Rpb24gKGEsIGIpIHtcbiAgICAgIHJldHVybiBhW2RpbWVuc2lvbnNbZGltXV0gLSBiW2RpbWVuc2lvbnNbZGltXV07XG4gICAgfSk7XG5cbiAgICBtZWRpYW4gPSBNYXRoLmZsb29yKHBvaW50cy5sZW5ndGggLyAyKTtcbiAgICBub2RlID0gbmV3IE5vZGUocG9pbnRzW21lZGlhbl0sIGRpbSwgcGFyZW50KTtcbiAgICBub2RlLmxlZnQgPSBidWlsZFRyZWUocG9pbnRzLnNsaWNlKDAsIG1lZGlhbiksIGRlcHRoICsgMSwgbm9kZSk7XG4gICAgbm9kZS5yaWdodCA9IGJ1aWxkVHJlZShwb2ludHMuc2xpY2UobWVkaWFuICsgMSksIGRlcHRoICsgMSwgbm9kZSk7XG5cbiAgICByZXR1cm4gbm9kZTtcbiAgfVxuXG4gIHRoaXMucm9vdCA9IGJ1aWxkVHJlZShwb2ludHMsIDAsIG51bGwpO1xuXG4gIHRoaXMuaW5zZXJ0ID0gZnVuY3Rpb24gKHBvaW50KSB7XG4gICAgZnVuY3Rpb24gaW5uZXJTZWFyY2gobm9kZSwgcGFyZW50KSB7XG5cbiAgICAgIGlmIChub2RlID09PSBudWxsKSB7XG4gICAgICAgIHJldHVybiBwYXJlbnQ7XG4gICAgICB9XG5cbiAgICAgIHZhciBkaW1lbnNpb24gPSBkaW1lbnNpb25zW25vZGUuZGltZW5zaW9uXTtcbiAgICAgIGlmIChwb2ludFtkaW1lbnNpb25dIDwgbm9kZS5vYmpbZGltZW5zaW9uXSkge1xuICAgICAgICByZXR1cm4gaW5uZXJTZWFyY2gobm9kZS5sZWZ0LCBub2RlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBpbm5lclNlYXJjaChub2RlLnJpZ2h0LCBub2RlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgaW5zZXJ0UG9zaXRpb24gPSBpbm5lclNlYXJjaCh0aGlzLnJvb3QsIG51bGwpLFxuICAgICAgbmV3Tm9kZSxcbiAgICAgIGRpbWVuc2lvbjtcblxuICAgIGlmIChpbnNlcnRQb3NpdGlvbiA9PT0gbnVsbCkge1xuICAgICAgdGhpcy5yb290ID0gbmV3IE5vZGUocG9pbnQsIDAsIG51bGwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIG5ld05vZGUgPSBuZXcgTm9kZShwb2ludCwgKGluc2VydFBvc2l0aW9uLmRpbWVuc2lvbiArIDEpICUgZGltZW5zaW9ucy5sZW5ndGgsIGluc2VydFBvc2l0aW9uKTtcbiAgICBkaW1lbnNpb24gPSBkaW1lbnNpb25zW2luc2VydFBvc2l0aW9uLmRpbWVuc2lvbl07XG5cbiAgICBpZiAocG9pbnRbZGltZW5zaW9uXSA8IGluc2VydFBvc2l0aW9uLm9ialtkaW1lbnNpb25dKSB7XG4gICAgICBpbnNlcnRQb3NpdGlvbi5sZWZ0ID0gbmV3Tm9kZTtcbiAgICB9IGVsc2Uge1xuICAgICAgaW5zZXJ0UG9zaXRpb24ucmlnaHQgPSBuZXdOb2RlO1xuICAgIH1cbiAgfTtcblxuICB0aGlzLnJlbW92ZSA9IGZ1bmN0aW9uIChwb2ludCkge1xuICAgIHZhciBub2RlO1xuXG4gICAgZnVuY3Rpb24gbm9kZVNlYXJjaChub2RlKSB7XG4gICAgICBpZiAobm9kZSA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cblxuICAgICAgaWYgKG5vZGUub2JqID09PSBwb2ludCkge1xuICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgIH1cblxuICAgICAgdmFyIGRpbWVuc2lvbiA9IGRpbWVuc2lvbnNbbm9kZS5kaW1lbnNpb25dO1xuXG4gICAgICBpZiAocG9pbnRbZGltZW5zaW9uXSA8IG5vZGUub2JqW2RpbWVuc2lvbl0pIHtcbiAgICAgICAgcmV0dXJuIG5vZGVTZWFyY2gobm9kZS5sZWZ0LCBub2RlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBub2RlU2VhcmNoKG5vZGUucmlnaHQsIG5vZGUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbW92ZU5vZGUobm9kZSkge1xuICAgICAgdmFyIG5leHROb2RlLFxuICAgICAgICBuZXh0T2JqLFxuICAgICAgICBwRGltZW5zaW9uO1xuXG4gICAgICBmdW5jdGlvbiBmaW5kTWF4KG5vZGUsIGRpbSkge1xuICAgICAgICB2YXIgZGltZW5zaW9uLFxuICAgICAgICAgIG93bixcbiAgICAgICAgICBsZWZ0LFxuICAgICAgICAgIHJpZ2h0LFxuICAgICAgICAgIG1heDtcblxuICAgICAgICBpZiAobm9kZSA9PT0gbnVsbCkge1xuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgZGltZW5zaW9uID0gZGltZW5zaW9uc1tkaW1dO1xuICAgICAgICBpZiAobm9kZS5kaW1lbnNpb24gPT09IGRpbSkge1xuICAgICAgICAgIGlmIChub2RlLnJpZ2h0ICE9PSBudWxsKSB7XG4gICAgICAgICAgICByZXR1cm4gZmluZE1heChub2RlLnJpZ2h0LCBkaW0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgICAgfVxuXG4gICAgICAgIG93biA9IG5vZGUub2JqW2RpbWVuc2lvbl07XG4gICAgICAgIGxlZnQgPSBmaW5kTWF4KG5vZGUubGVmdCwgZGltKTtcbiAgICAgICAgcmlnaHQgPSBmaW5kTWF4KG5vZGUucmlnaHQsIGRpbSk7XG4gICAgICAgIG1heCA9IG5vZGU7XG5cbiAgICAgICAgaWYgKGxlZnQgIT09IG51bGwgJiYgbGVmdC5vYmpbZGltZW5zaW9uXSA+IG93bikge1xuICAgICAgICAgIG1heCA9IGxlZnQ7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocmlnaHQgIT09IG51bGwgJiYgcmlnaHQub2JqW2RpbWVuc2lvbl0gPiBtYXgub2JqW2RpbWVuc2lvbl0pIHtcbiAgICAgICAgICBtYXggPSByaWdodDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbWF4O1xuICAgICAgfVxuXG4gICAgICBmdW5jdGlvbiBmaW5kTWluKG5vZGUsIGRpbSkge1xuICAgICAgICB2YXIgZGltZW5zaW9uLFxuICAgICAgICAgIG93bixcbiAgICAgICAgICBsZWZ0LFxuICAgICAgICAgIHJpZ2h0LFxuICAgICAgICAgIG1pbjtcblxuICAgICAgICBpZiAobm9kZSA9PT0gbnVsbCkge1xuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgZGltZW5zaW9uID0gZGltZW5zaW9uc1tkaW1dO1xuXG4gICAgICAgIGlmIChub2RlLmRpbWVuc2lvbiA9PT0gZGltKSB7XG4gICAgICAgICAgaWYgKG5vZGUubGVmdCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgcmV0dXJuIGZpbmRNaW4obm9kZS5sZWZ0LCBkaW0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgICAgfVxuXG4gICAgICAgIG93biA9IG5vZGUub2JqW2RpbWVuc2lvbl07XG4gICAgICAgIGxlZnQgPSBmaW5kTWluKG5vZGUubGVmdCwgZGltKTtcbiAgICAgICAgcmlnaHQgPSBmaW5kTWluKG5vZGUucmlnaHQsIGRpbSk7XG4gICAgICAgIG1pbiA9IG5vZGU7XG5cbiAgICAgICAgaWYgKGxlZnQgIT09IG51bGwgJiYgbGVmdC5vYmpbZGltZW5zaW9uXSA8IG93bikge1xuICAgICAgICAgIG1pbiA9IGxlZnQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJpZ2h0ICE9PSBudWxsICYmIHJpZ2h0Lm9ialtkaW1lbnNpb25dIDwgbWluLm9ialtkaW1lbnNpb25dKSB7XG4gICAgICAgICAgbWluID0gcmlnaHQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG1pbjtcbiAgICAgIH1cblxuICAgICAgaWYgKG5vZGUubGVmdCA9PT0gbnVsbCAmJiBub2RlLnJpZ2h0ID09PSBudWxsKSB7XG4gICAgICAgIGlmIChub2RlLnBhcmVudCA9PT0gbnVsbCkge1xuICAgICAgICAgIHNlbGYucm9vdCA9IG51bGw7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgcERpbWVuc2lvbiA9IGRpbWVuc2lvbnNbbm9kZS5wYXJlbnQuZGltZW5zaW9uXTtcblxuICAgICAgICBpZiAobm9kZS5vYmpbcERpbWVuc2lvbl0gPCBub2RlLnBhcmVudC5vYmpbcERpbWVuc2lvbl0pIHtcbiAgICAgICAgICBub2RlLnBhcmVudC5sZWZ0ID0gbnVsbDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBub2RlLnBhcmVudC5yaWdodCA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAobm9kZS5sZWZ0ICE9PSBudWxsKSB7XG4gICAgICAgIG5leHROb2RlID0gZmluZE1heChub2RlLmxlZnQsIG5vZGUuZGltZW5zaW9uKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG5leHROb2RlID0gZmluZE1pbihub2RlLnJpZ2h0LCBub2RlLmRpbWVuc2lvbik7XG4gICAgICB9XG5cbiAgICAgIG5leHRPYmogPSBuZXh0Tm9kZS5vYmo7XG4gICAgICByZW1vdmVOb2RlKG5leHROb2RlKTtcbiAgICAgIG5vZGUub2JqID0gbmV4dE9iajtcblxuICAgIH1cblxuICAgIG5vZGUgPSBub2RlU2VhcmNoKHNlbGYucm9vdCk7XG5cbiAgICBpZiAobm9kZSA9PT0gbnVsbCkgeyByZXR1cm47IH1cblxuICAgIHJlbW92ZU5vZGUobm9kZSk7XG4gIH07XG5cbiAgdGhpcy5uZWFyZXN0ID0gZnVuY3Rpb24gKHBvaW50LCBtYXhOb2RlcywgbWF4RGlzdGFuY2UpIHtcbiAgICB2YXIgaSxcbiAgICAgIHJlc3VsdCxcbiAgICAgIGJlc3ROb2RlcztcblxuICAgIGJlc3ROb2RlcyA9IG5ldyBCaW5hcnlIZWFwKFxuICAgICAgZnVuY3Rpb24gKGUpIHsgcmV0dXJuIC1lWzFdOyB9XG4gICAgKTtcblxuICAgIGZ1bmN0aW9uIG5lYXJlc3RTZWFyY2gobm9kZSkge1xuICAgICAgdmFyIGJlc3RDaGlsZCxcbiAgICAgICAgZGltZW5zaW9uID0gZGltZW5zaW9uc1tub2RlLmRpbWVuc2lvbl0sXG4gICAgICAgIG93bkRpc3RhbmNlID0gbWV0cmljKHBvaW50LCBub2RlLm9iaiksXG4gICAgICAgIGxpbmVhclBvaW50ID0ge30sXG4gICAgICAgIGxpbmVhckRpc3RhbmNlLFxuICAgICAgICBvdGhlckNoaWxkLFxuICAgICAgICBpO1xuXG4gICAgICBmdW5jdGlvbiBzYXZlTm9kZShub2RlLCBkaXN0YW5jZSkge1xuICAgICAgICBiZXN0Tm9kZXMucHVzaChbbm9kZSwgZGlzdGFuY2VdKTtcbiAgICAgICAgaWYgKGJlc3ROb2Rlcy5zaXplKCkgPiBtYXhOb2Rlcykge1xuICAgICAgICAgIGJlc3ROb2Rlcy5wb3AoKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBmb3IgKGkgPSAwOyBpIDwgZGltZW5zaW9ucy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBpZiAoaSA9PT0gbm9kZS5kaW1lbnNpb24pIHtcbiAgICAgICAgICBsaW5lYXJQb2ludFtkaW1lbnNpb25zW2ldXSA9IHBvaW50W2RpbWVuc2lvbnNbaV1dO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGxpbmVhclBvaW50W2RpbWVuc2lvbnNbaV1dID0gbm9kZS5vYmpbZGltZW5zaW9uc1tpXV07XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgbGluZWFyRGlzdGFuY2UgPSBtZXRyaWMobGluZWFyUG9pbnQsIG5vZGUub2JqKTtcblxuICAgICAgaWYgKG5vZGUucmlnaHQgPT09IG51bGwgJiYgbm9kZS5sZWZ0ID09PSBudWxsKSB7XG4gICAgICAgIGlmIChiZXN0Tm9kZXMuc2l6ZSgpIDwgbWF4Tm9kZXMgfHwgb3duRGlzdGFuY2UgPCBiZXN0Tm9kZXMucGVlaygpWzFdKSB7XG4gICAgICAgICAgc2F2ZU5vZGUobm9kZSwgb3duRGlzdGFuY2UpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKG5vZGUucmlnaHQgPT09IG51bGwpIHtcbiAgICAgICAgYmVzdENoaWxkID0gbm9kZS5sZWZ0O1xuICAgICAgfSBlbHNlIGlmIChub2RlLmxlZnQgPT09IG51bGwpIHtcbiAgICAgICAgYmVzdENoaWxkID0gbm9kZS5yaWdodDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChwb2ludFtkaW1lbnNpb25dIDwgbm9kZS5vYmpbZGltZW5zaW9uXSkge1xuICAgICAgICAgIGJlc3RDaGlsZCA9IG5vZGUubGVmdDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBiZXN0Q2hpbGQgPSBub2RlLnJpZ2h0O1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIG5lYXJlc3RTZWFyY2goYmVzdENoaWxkKTtcblxuICAgICAgaWYgKGJlc3ROb2Rlcy5zaXplKCkgPCBtYXhOb2RlcyB8fCBvd25EaXN0YW5jZSA8IGJlc3ROb2Rlcy5wZWVrKClbMV0pIHtcbiAgICAgICAgc2F2ZU5vZGUobm9kZSwgb3duRGlzdGFuY2UpO1xuICAgICAgfVxuXG4gICAgICBpZiAoYmVzdE5vZGVzLnNpemUoKSA8IG1heE5vZGVzIHx8IE1hdGguYWJzKGxpbmVhckRpc3RhbmNlKSA8IGJlc3ROb2Rlcy5wZWVrKClbMV0pIHtcbiAgICAgICAgaWYgKGJlc3RDaGlsZCA9PT0gbm9kZS5sZWZ0KSB7XG4gICAgICAgICAgb3RoZXJDaGlsZCA9IG5vZGUucmlnaHQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgb3RoZXJDaGlsZCA9IG5vZGUubGVmdDtcbiAgICAgICAgfVxuICAgICAgICBpZiAob3RoZXJDaGlsZCAhPT0gbnVsbCkge1xuICAgICAgICAgIG5lYXJlc3RTZWFyY2gob3RoZXJDaGlsZCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAobWF4RGlzdGFuY2UpIHtcbiAgICAgIGZvciAoaSA9IDA7IGkgPCBtYXhOb2RlczsgaSArPSAxKSB7XG4gICAgICAgIGJlc3ROb2Rlcy5wdXNoKFtudWxsLCBtYXhEaXN0YW5jZV0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIG5lYXJlc3RTZWFyY2goc2VsZi5yb290KTtcblxuICAgIHJlc3VsdCA9IFtdO1xuXG4gICAgZm9yIChpID0gMDsgaSA8IG1heE5vZGVzOyBpICs9IDEpIHtcbiAgICAgIGlmIChiZXN0Tm9kZXMuY29udGVudFtpXVswXSkge1xuICAgICAgICByZXN1bHQucHVzaChbYmVzdE5vZGVzLmNvbnRlbnRbaV1bMF0ub2JqLCBiZXN0Tm9kZXMuY29udGVudFtpXVsxXV0pO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIHRoaXMuYmFsYW5jZUZhY3RvciA9IGZ1bmN0aW9uICgpIHtcbiAgICBmdW5jdGlvbiBoZWlnaHQobm9kZSkge1xuICAgICAgaWYgKG5vZGUgPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgICB9XG4gICAgICByZXR1cm4gTWF0aC5tYXgoaGVpZ2h0KG5vZGUubGVmdCksIGhlaWdodChub2RlLnJpZ2h0KSkgKyAxO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNvdW50KG5vZGUpIHtcbiAgICAgIGlmIChub2RlID09PSBudWxsKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGNvdW50KG5vZGUubGVmdCkgKyBjb3VudChub2RlLnJpZ2h0KSArIDE7XG4gICAgfVxuXG4gICAgcmV0dXJuIGhlaWdodChzZWxmLnJvb3QpIC8gKE1hdGgubG9nKGNvdW50KHNlbGYucm9vdCkpIC8gTWF0aC5sb2coMikpO1xuICB9O1xufVxuXG4vLyBCaW5hcnkgaGVhcCBpbXBsZW1lbnRhdGlvbiBmcm9tOlxuLy8gaHR0cDovL2Vsb3F1ZW50amF2YXNjcmlwdC5uZXQvYXBwZW5kaXgyLmh0bWxcblxuZnVuY3Rpb24gQmluYXJ5SGVhcChzY29yZUZ1bmN0aW9uKXtcbiAgdGhpcy5jb250ZW50ID0gW107XG4gIHRoaXMuc2NvcmVGdW5jdGlvbiA9IHNjb3JlRnVuY3Rpb247XG59XG5cbkJpbmFyeUhlYXAucHJvdG90eXBlID0ge1xuICBwdXNoOiBmdW5jdGlvbihlbGVtZW50KSB7XG4gICAgLy8gQWRkIHRoZSBuZXcgZWxlbWVudCB0byB0aGUgZW5kIG9mIHRoZSBhcnJheS5cbiAgICB0aGlzLmNvbnRlbnQucHVzaChlbGVtZW50KTtcbiAgICAvLyBBbGxvdyBpdCB0byBidWJibGUgdXAuXG4gICAgdGhpcy5idWJibGVVcCh0aGlzLmNvbnRlbnQubGVuZ3RoIC0gMSk7XG4gIH0sXG5cbiAgcG9wOiBmdW5jdGlvbigpIHtcbiAgICAvLyBTdG9yZSB0aGUgZmlyc3QgZWxlbWVudCBzbyB3ZSBjYW4gcmV0dXJuIGl0IGxhdGVyLlxuICAgIHZhciByZXN1bHQgPSB0aGlzLmNvbnRlbnRbMF07XG4gICAgLy8gR2V0IHRoZSBlbGVtZW50IGF0IHRoZSBlbmQgb2YgdGhlIGFycmF5LlxuICAgIHZhciBlbmQgPSB0aGlzLmNvbnRlbnQucG9wKCk7XG4gICAgLy8gSWYgdGhlcmUgYXJlIGFueSBlbGVtZW50cyBsZWZ0LCBwdXQgdGhlIGVuZCBlbGVtZW50IGF0IHRoZVxuICAgIC8vIHN0YXJ0LCBhbmQgbGV0IGl0IHNpbmsgZG93bi5cbiAgICBpZiAodGhpcy5jb250ZW50Lmxlbmd0aCA+IDApIHtcbiAgICAgIHRoaXMuY29udGVudFswXSA9IGVuZDtcbiAgICAgIHRoaXMuc2lua0Rvd24oMCk7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH0sXG5cbiAgcGVlazogZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuY29udGVudFswXTtcbiAgfSxcblxuICByZW1vdmU6IGZ1bmN0aW9uKG5vZGUpIHtcbiAgICB2YXIgbGVuID0gdGhpcy5jb250ZW50Lmxlbmd0aDtcbiAgICAvLyBUbyByZW1vdmUgYSB2YWx1ZSwgd2UgbXVzdCBzZWFyY2ggdGhyb3VnaCB0aGUgYXJyYXkgdG8gZmluZFxuICAgIC8vIGl0LlxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIGlmICh0aGlzLmNvbnRlbnRbaV0gPT0gbm9kZSkge1xuICAgICAgICAvLyBXaGVuIGl0IGlzIGZvdW5kLCB0aGUgcHJvY2VzcyBzZWVuIGluICdwb3AnIGlzIHJlcGVhdGVkXG4gICAgICAgIC8vIHRvIGZpbGwgdXAgdGhlIGhvbGUuXG4gICAgICAgIHZhciBlbmQgPSB0aGlzLmNvbnRlbnQucG9wKCk7XG4gICAgICAgIGlmIChpICE9IGxlbiAtIDEpIHtcbiAgICAgICAgICB0aGlzLmNvbnRlbnRbaV0gPSBlbmQ7XG4gICAgICAgICAgaWYgKHRoaXMuc2NvcmVGdW5jdGlvbihlbmQpIDwgdGhpcy5zY29yZUZ1bmN0aW9uKG5vZGUpKVxuICAgICAgICAgICAgdGhpcy5idWJibGVVcChpKTtcbiAgICAgICAgICBlbHNlXG4gICAgICAgICAgICB0aGlzLnNpbmtEb3duKGkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiTm9kZSBub3QgZm91bmQuXCIpO1xuICB9LFxuXG4gIHNpemU6IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmNvbnRlbnQubGVuZ3RoO1xuICB9LFxuXG4gIGJ1YmJsZVVwOiBmdW5jdGlvbihuKSB7XG4gICAgLy8gRmV0Y2ggdGhlIGVsZW1lbnQgdGhhdCBoYXMgdG8gYmUgbW92ZWQuXG4gICAgdmFyIGVsZW1lbnQgPSB0aGlzLmNvbnRlbnRbbl07XG4gICAgLy8gV2hlbiBhdCAwLCBhbiBlbGVtZW50IGNhbiBub3QgZ28gdXAgYW55IGZ1cnRoZXIuXG4gICAgd2hpbGUgKG4gPiAwKSB7XG4gICAgICAvLyBDb21wdXRlIHRoZSBwYXJlbnQgZWxlbWVudCdzIGluZGV4LCBhbmQgZmV0Y2ggaXQuXG4gICAgICB2YXIgcGFyZW50TiA9IE1hdGguZmxvb3IoKG4gKyAxKSAvIDIpIC0gMSxcbiAgICAgICAgICBwYXJlbnQgPSB0aGlzLmNvbnRlbnRbcGFyZW50Tl07XG4gICAgICAvLyBTd2FwIHRoZSBlbGVtZW50cyBpZiB0aGUgcGFyZW50IGlzIGdyZWF0ZXIuXG4gICAgICBpZiAodGhpcy5zY29yZUZ1bmN0aW9uKGVsZW1lbnQpIDwgdGhpcy5zY29yZUZ1bmN0aW9uKHBhcmVudCkpIHtcbiAgICAgICAgdGhpcy5jb250ZW50W3BhcmVudE5dID0gZWxlbWVudDtcbiAgICAgICAgdGhpcy5jb250ZW50W25dID0gcGFyZW50O1xuICAgICAgICAvLyBVcGRhdGUgJ24nIHRvIGNvbnRpbnVlIGF0IHRoZSBuZXcgcG9zaXRpb24uXG4gICAgICAgIG4gPSBwYXJlbnROO1xuICAgICAgfVxuICAgICAgLy8gRm91bmQgYSBwYXJlbnQgdGhhdCBpcyBsZXNzLCBubyBuZWVkIHRvIG1vdmUgaXQgZnVydGhlci5cbiAgICAgIGVsc2Uge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgc2lua0Rvd246IGZ1bmN0aW9uKG4pIHtcbiAgICAvLyBMb29rIHVwIHRoZSB0YXJnZXQgZWxlbWVudCBhbmQgaXRzIHNjb3JlLlxuICAgIHZhciBsZW5ndGggPSB0aGlzLmNvbnRlbnQubGVuZ3RoLFxuICAgICAgICBlbGVtZW50ID0gdGhpcy5jb250ZW50W25dLFxuICAgICAgICBlbGVtU2NvcmUgPSB0aGlzLnNjb3JlRnVuY3Rpb24oZWxlbWVudCk7XG5cbiAgICB3aGlsZSh0cnVlKSB7XG4gICAgICAvLyBDb21wdXRlIHRoZSBpbmRpY2VzIG9mIHRoZSBjaGlsZCBlbGVtZW50cy5cbiAgICAgIHZhciBjaGlsZDJOID0gKG4gKyAxKSAqIDIsIGNoaWxkMU4gPSBjaGlsZDJOIC0gMTtcbiAgICAgIC8vIFRoaXMgaXMgdXNlZCB0byBzdG9yZSB0aGUgbmV3IHBvc2l0aW9uIG9mIHRoZSBlbGVtZW50LFxuICAgICAgLy8gaWYgYW55LlxuICAgICAgdmFyIHN3YXAgPSBudWxsO1xuICAgICAgLy8gSWYgdGhlIGZpcnN0IGNoaWxkIGV4aXN0cyAoaXMgaW5zaWRlIHRoZSBhcnJheSkuLi5cbiAgICAgIGlmIChjaGlsZDFOIDwgbGVuZ3RoKSB7XG4gICAgICAgIC8vIExvb2sgaXQgdXAgYW5kIGNvbXB1dGUgaXRzIHNjb3JlLlxuICAgICAgICB2YXIgY2hpbGQxID0gdGhpcy5jb250ZW50W2NoaWxkMU5dLFxuICAgICAgICAgICAgY2hpbGQxU2NvcmUgPSB0aGlzLnNjb3JlRnVuY3Rpb24oY2hpbGQxKTtcbiAgICAgICAgLy8gSWYgdGhlIHNjb3JlIGlzIGxlc3MgdGhhbiBvdXIgZWxlbWVudCdzLCB3ZSBuZWVkIHRvIHN3YXAuXG4gICAgICAgIGlmIChjaGlsZDFTY29yZSA8IGVsZW1TY29yZSlcbiAgICAgICAgICBzd2FwID0gY2hpbGQxTjtcbiAgICAgIH1cbiAgICAgIC8vIERvIHRoZSBzYW1lIGNoZWNrcyBmb3IgdGhlIG90aGVyIGNoaWxkLlxuICAgICAgaWYgKGNoaWxkMk4gPCBsZW5ndGgpIHtcbiAgICAgICAgdmFyIGNoaWxkMiA9IHRoaXMuY29udGVudFtjaGlsZDJOXSxcbiAgICAgICAgICAgIGNoaWxkMlNjb3JlID0gdGhpcy5zY29yZUZ1bmN0aW9uKGNoaWxkMik7XG4gICAgICAgIGlmIChjaGlsZDJTY29yZSA8IChzd2FwID09IG51bGwgPyBlbGVtU2NvcmUgOiBjaGlsZDFTY29yZSkpe1xuICAgICAgICAgIHN3YXAgPSBjaGlsZDJOO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIElmIHRoZSBlbGVtZW50IG5lZWRzIHRvIGJlIG1vdmVkLCBzd2FwIGl0LCBhbmQgY29udGludWUuXG4gICAgICBpZiAoc3dhcCAhPSBudWxsKSB7XG4gICAgICAgIHRoaXMuY29udGVudFtuXSA9IHRoaXMuY29udGVudFtzd2FwXTtcbiAgICAgICAgdGhpcy5jb250ZW50W3N3YXBdID0gZWxlbWVudDtcbiAgICAgICAgbiA9IHN3YXA7XG4gICAgICB9XG4gICAgICAvLyBPdGhlcndpc2UsIHdlIGFyZSBkb25lLlxuICAgICAgZWxzZSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIGNyZWF0ZUtkVHJlZTogZnVuY3Rpb24gKHBvaW50cywgbWV0cmljLCBkaW1lbnNpb25zKSB7XG4gICAgcmV0dXJuIG5ldyBLZFRyZWUocG9pbnRzLCBtZXRyaWMsIGRpbWVuc2lvbnMpXG4gIH1cbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9kaXN0L2JpcXVhZC1maWx0ZXInKTtcbiIsIi8qKlxuICogQGZpbGVvdmVydmlldyBCaXF1YWQgRmlsdGVyIGxpYnJhcnlcbiAqIEBhdXRob3IgQXJuYXUuSnVsaWEgPEFybmF1Lkp1bGlhQGdtYWlsLmNvbT5cbiAqIEB2ZXJzaW9uIDAuMS4wXG4gKi9cblxuLyoqXG4gKiBAY2xhc3MgQmlxdWFkRmlsdGVyXG4gKiBAcHVibGljXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJpcXVhZEZpbHRlciB7XG4gICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgIHRoaXMuY29lZmZpY2llbnRzID0gW107XG4gICAgICAgIHRoaXMubnVtYmVyT2ZDYXNjYWRlID0gMTtcbiAgICAgICAgdGhpcy5yZXNldE1lbW9yaWVzKCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2V0IGJpcXVhZCBmaWx0ZXIgY29lZmZpY2llbnRzXG4gICAgICogQHB1YmxpY1xuICAgICAqIEBwYXJhbSBjb2VmIEFycmF5IG9mIGJpcXVhZCBjb2VmZmljaWVudHMgaW4gdGhlIGZvbGxvd2luZyBvcmRlcjogZ2FpbiwgZmlyc3RCaXF1YWQgYjEsIGZpcnN0QmlxdWFkIGIyLCBmaXJzdEJpcXVhZCBhMSwgZmlyc3RCaXF1YWQgYTIsIHNlY29uZEJpcXVhZCBiMSwgc2Vjb25kQklxdWFkIGIyLCBldGMuXG4gICAgICovXG4gICAgc2V0Q29lZmZpY2llbnRzKGNvZWYpIHtcbiAgICAgICAgaWYgKGNvZWYpIHtcbiAgICAgICAgICAgIC8vIElmIHRoZXJlIGlzIG5vdCBhIG51bWJlciBvZiBiaXF1YWRzLCB3ZSBjb25zaWRlciB0aGF0IHRoZXJlIGlzIG9ubHkgMSBiaXF1YWQuXG4gICAgICAgICAgICB0aGlzLm51bWJlck9mQ2FzY2FkZSA9IHRoaXMuZ2V0TnVtYmVyT2ZDYXNjYWRlRmlsdGVycyhjb2VmKTtcbiAgICAgICAgICAgIC8vIFJlc2V0IGNvZWZmaWNpZW50c1xuICAgICAgICAgICAgdGhpcy5jb2VmZmljaWVudHMgPSBbXTtcbiAgICAgICAgICAgIC8vIEdsb2JhbCBnYWluXG4gICAgICAgICAgICB0aGlzLmNvZWZmaWNpZW50cy5nID0gY29lZlswXTtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5udW1iZXJPZkNhc2NhZGU7IGkrKykge1xuICAgICAgICAgICAgICAgIC8vIEZvdXIgY29lZmZpY2llbnRzIGZvciBlYWNoIGJpcXVhZFxuICAgICAgICAgICAgICAgIHRoaXMuY29lZmZpY2llbnRzW2ldID0ge1xuICAgICAgICAgICAgICAgICAgICBiMTogY29lZlsxICsgaSAqIDRdLFxuICAgICAgICAgICAgICAgICAgICBiMjogY29lZlsyICsgaSAqIDRdLFxuICAgICAgICAgICAgICAgICAgICBhMTogY29lZlszICsgaSAqIDRdLFxuICAgICAgICAgICAgICAgICAgICBhMjogY29lZls0ICsgaSAqIDRdXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIE5lZWQgdG8gcmVzZXQgdGhlIG1lbW9yaWVzIGFmdGVyIGNoYW5nZSB0aGUgY29lZmZpY2llbnRzXG4gICAgICAgICAgICB0aGlzLnJlc2V0TWVtb3JpZXMoKTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29lZmZpY2llbnRzIGFyZSBzZXRcIik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIG51bWJlciBvZiBjYXNjYWRlIGZpbHRlcnMgZnJvbSB0aGUgbGlzdCBvZiBjb2VmZmljaWVudHNcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIGdldE51bWJlck9mQ2FzY2FkZUZpbHRlcnMoY29lZikge1xuICAgICAgICByZXR1cm4gKGNvZWYubGVuZ3RoIC0gMSkgLyA0O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJlc2V0IG1lbW9yaWVzIG9mIGJpcXVhZCBmaWx0ZXJzLlxuICAgICAqIEBwdWJsaWNcbiAgICAgKi9cbiAgICByZXNldE1lbW9yaWVzKCkge1xuICAgICAgICB0aGlzLm1lbW9yaWVzID0gW3tcbiAgICAgICAgICAgIHhpMTogMCxcbiAgICAgICAgICAgIHhpMjogMCxcbiAgICAgICAgICAgIHlpMTogMCxcbiAgICAgICAgICAgIHlpMjogMFxuICAgICAgICB9XTtcbiAgICAgICAgLy8gc2VlIGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9hLzE5ODkyMTQ0XG4gICAgICAgIGZvciAodmFyIGkgPSAxOyBpIDwgdGhpcy5udW1iZXJPZkNhc2NhZGU7IGkrKykge1xuICAgICAgICAgICAgdGhpcy5tZW1vcmllc1tpXSA9IHtcbiAgICAgICAgICAgICAgICB5aTE6IDAsXG4gICAgICAgICAgICAgICAgeWkyOiAwXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2FsY3VsYXRlIHRoZSBvdXRwdXQgb2YgdGhlIGNhc2NhZGUgb2YgYmlxdWFkIGZpbHRlcnMgZm9yIGFuIGlucHV0QnVmZmVyLlxuICAgICAqIEBwdWJsaWNcbiAgICAgKiBAcGFyYW0gaW5wdXRCdWZmZXIgQXJyYXkgb2YgdGhlIHNhbWUgbGVuZ3RoIG9mIG91dHB1dEJ1ZmZlclxuICAgICAqIEBwYXJhbSBvdXRwdXRCdWZmZXIgQXJyYXkgb2YgdGhlIHNhbWUgbGVuZ3RoIG9mIGlucHV0QnVmZmVyXG4gICAgICovXG4gICAgcHJvY2VzcyhpbnB1dEJ1ZmZlciwgb3V0cHV0QnVmZmVyKSB7XG4gICAgICAgIHZhciB4O1xuICAgICAgICB2YXIgeSA9IFtdO1xuICAgICAgICB2YXIgYjEsIGIyLCBhMSwgYTI7XG4gICAgICAgIHZhciB4aTEsIHhpMiwgeWkxLCB5aTIsIHkxaTEsIHkxaTI7XG5cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBpbnB1dEJ1ZmZlci5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgeCA9IGlucHV0QnVmZmVyW2ldO1xuICAgICAgICAgICAgLy8gU2F2ZSBjb2VmZmljaWVudHMgaW4gbG9jYWwgdmFyaWFibGVzXG4gICAgICAgICAgICBiMSA9IHRoaXMuY29lZmZpY2llbnRzWzBdLmIxO1xuICAgICAgICAgICAgYjIgPSB0aGlzLmNvZWZmaWNpZW50c1swXS5iMjtcbiAgICAgICAgICAgIGExID0gdGhpcy5jb2VmZmljaWVudHNbMF0uYTE7XG4gICAgICAgICAgICBhMiA9IHRoaXMuY29lZmZpY2llbnRzWzBdLmEyO1xuICAgICAgICAgICAgLy8gU2F2ZSBtZW1vcmllcyBpbiBsb2NhbCB2YXJpYWJsZXNcbiAgICAgICAgICAgIHhpMSA9IHRoaXMubWVtb3JpZXNbMF0ueGkxO1xuICAgICAgICAgICAgeGkyID0gdGhpcy5tZW1vcmllc1swXS54aTI7XG4gICAgICAgICAgICB5aTEgPSB0aGlzLm1lbW9yaWVzWzBdLnlpMTtcbiAgICAgICAgICAgIHlpMiA9IHRoaXMubWVtb3JpZXNbMF0ueWkyO1xuXG4gICAgICAgICAgICAvLyBGb3JtdWxhOiB5W25dID0geFtuXSArIGIxKnhbbi0xXSArIGIyKnhbbi0yXSAtIGExKnlbbi0xXSAtIGEyKnlbbi0yXVxuICAgICAgICAgICAgLy8gRmlyc3QgYmlxdWFkXG4gICAgICAgICAgICB5WzBdID0geCArIGIxICogeGkxICsgYjIgKiB4aTIgLSBhMSAqIHlpMSAtIGEyICogeWkyO1xuXG4gICAgICAgICAgICBmb3IgKHZhciBlID0gMTsgZSA8IHRoaXMubnVtYmVyT2ZDYXNjYWRlOyBlKyspIHtcbiAgICAgICAgICAgICAgICAvLyBTYXZlIGNvZWZmaWNpZW50cyBpbiBsb2NhbCB2YXJpYWJsZXNcbiAgICAgICAgICAgICAgICBiMSA9IHRoaXMuY29lZmZpY2llbnRzW2VdLmIxO1xuICAgICAgICAgICAgICAgIGIyID0gdGhpcy5jb2VmZmljaWVudHNbZV0uYjI7XG4gICAgICAgICAgICAgICAgYTEgPSB0aGlzLmNvZWZmaWNpZW50c1tlXS5hMTtcbiAgICAgICAgICAgICAgICBhMiA9IHRoaXMuY29lZmZpY2llbnRzW2VdLmEyO1xuICAgICAgICAgICAgICAgIC8vIFNhdmUgbWVtb3JpZXMgaW4gbG9jYWwgdmFyaWFibGVzXG4gICAgICAgICAgICAgICAgeTFpMSA9IHRoaXMubWVtb3JpZXNbZSAtIDFdLnlpMTtcbiAgICAgICAgICAgICAgICB5MWkyID0gdGhpcy5tZW1vcmllc1tlIC0gMV0ueWkyO1xuICAgICAgICAgICAgICAgIHlpMSA9IHRoaXMubWVtb3JpZXNbZV0ueWkxO1xuICAgICAgICAgICAgICAgIHlpMiA9IHRoaXMubWVtb3JpZXNbZV0ueWkyO1xuXG4gICAgICAgICAgICAgICAgeVtlXSA9IHlbZSAtIDFdICsgYjEgKiB5MWkxICsgYjIgKiB5MWkyIC0gYTEgKiB5aTEgLSBhMiAqIHlpMjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gV3JpdGUgdGhlIG91dHB1dFxuICAgICAgICAgICAgb3V0cHV0QnVmZmVyW2ldID0geVt0aGlzLm51bWJlck9mQ2FzY2FkZSAtIDFdICogdGhpcy5jb2VmZmljaWVudHMuZztcblxuICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSBtZW1vcmllc1xuICAgICAgICAgICAgdGhpcy5tZW1vcmllc1swXS54aTIgPSB0aGlzLm1lbW9yaWVzWzBdLnhpMTtcbiAgICAgICAgICAgIHRoaXMubWVtb3JpZXNbMF0ueGkxID0geDtcblxuICAgICAgICAgICAgZm9yICh2YXIgcCA9IDA7IHAgPCB0aGlzLm51bWJlck9mQ2FzY2FkZTsgcCsrKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5tZW1vcmllc1twXS55aTIgPSB0aGlzLm1lbW9yaWVzW3BdLnlpMTtcbiAgICAgICAgICAgICAgICB0aGlzLm1lbW9yaWVzW3BdLnlpMSA9IHlbcF07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59XG4iLCIvKipcbiAqIEBmaWxlb3ZlcnZpZXcgRnJhY3Rpb25hbCBkZWxheSBsaWJyYXJ5XG4gKiBAYXV0aG9yIEFybmF1IEp1bGnDoCA8QXJuYXUuSnVsaWFAZ21haWwuY29tPlxuICogQHZlcnNpb24gMC4xLjBcbiAqL1xuLyoqXG4gKiBAY2xhc3MgRnJhY3Rpb25hbERlbGF5XG4gKiBAcHVibGljXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZyYWN0aW9uYWxEZWxheSB7XG4gICAgLyoqXG4gICAgICogTWFuZGF0b3J5IGluaXRpYWxpemF0aW9uIG1ldGhvZC5cbiAgICAgKiBAcHVibGljXG4gICAgICogQHBhcmFtIHVuaXRzOkh6IHNhbXBsZVJhdGUgU2FtcGxlIFJhdGUgdGhlIGFwcGFyYXR1cyBvcGVyYXRlcyBvbi5cbiAgICAgKiBAcGFyYW0gdHlwZTpGbG9hdCB1bml0czpzIG1pbjowLjAgZGVmYXVsdDoxIG9wdE1heERlbGF5VGltZSBUaGUgbWF4aW11bSBkZWxheSB0aW1lLlxuICAgICAqIEBjaGFpbmFibGVcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3RvcihzYW1wbGVSYXRlLCBvcHRNYXhEZWxheVRpbWUpIHtcbiAgICAgICAgLy8gUHJvcGVydGllcyB3aXRoIGRlZmF1bHQgdmFsdWVzXG4gICAgICAgIHRoaXMuZGVsYXlUaW1lID0gMDtcbiAgICAgICAgdGhpcy5wb3NSZWFkID0gMDtcbiAgICAgICAgdGhpcy5wb3NXcml0ZSA9IDA7XG4gICAgICAgIHRoaXMuZnJhY1hpMSA9IDA7XG4gICAgICAgIHRoaXMuZnJhY1lpMSA9IDA7XG4gICAgICAgIHRoaXMuaW50RGVsYXkgPSAwO1xuICAgICAgICB0aGlzLmZyYWNEZWxheSA9IDA7XG5cbiAgICAgICAgLy8gT3RoZXIgcHJvcGVydGllc1xuICAgICAgICB0aGlzLmExID0gdW5kZWZpbmVkO1xuXG4gICAgICAgIC8vIFNhdmUgc2FtcGxlIHJhdGVcbiAgICAgICAgdGhpcy5zYW1wbGVSYXRlID0gc2FtcGxlUmF0ZTtcbiAgICAgICAgdGhpcy5tYXhEZWxheVRpbWUgPSBvcHRNYXhEZWxheVRpbWUgfHwgMTtcblxuICAgICAgICB0aGlzLmJ1ZmZlclNpemUgPSB0aGlzLm1heERlbGF5VGltZSAqIHRoaXMuc2FtcGxlUmF0ZTtcbiAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIGJ1ZmZlclNpemUgaXMgbm90IGFuIGludGVnZXJcbiAgICAgICAgaWYgKHRoaXMuYnVmZmVyU2l6ZSAlIDEgIT09IDApIHtcbiAgICAgICAgICAgIHRoaXMuYnVmZmVyU2l6ZSA9IHBhcnNlSW50KHRoaXMuYnVmZmVyU2l6ZSkgKyAxO1xuICAgICAgICB9XG4gICAgICAgIC8vIENyZWF0ZSB0aGUgaW50ZXJuYWwgYnVmZmVyXG4gICAgICAgIHRoaXMuYnVmZmVyID0gbmV3IEZsb2F0MzJBcnJheSh0aGlzLmJ1ZmZlclNpemUpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNldCBkZWxheSB2YWx1ZVxuICAgICAqIEBwYXJhbSBkZWxheVRpbWUgRGVsYXkgdGltZVxuICAgICAqIEBwdWJsaWNcbiAgICAgKi9cbiAgICBzZXREZWxheShkZWxheVRpbWUpIHtcbiAgICAgICAgaWYgKGRlbGF5VGltZSA8IHRoaXMubWF4RGVsYXlUaW1lKSB7XG4gICAgICAgICAgICAvLyBTYXZlIGRlbGF5IHZhbHVlXG4gICAgICAgICAgICB0aGlzLmRlbGF5VGltZSA9IGRlbGF5VGltZTtcbiAgICAgICAgICAgIC8vIFRyYW5zZm9ybSB0aW1lIGluIHNhbXBsZXNcbiAgICAgICAgICAgIHZhciBzYW1wbGVzRGVsYXkgPSBkZWxheVRpbWUgKiB0aGlzLnNhbXBsZVJhdGU7XG4gICAgICAgICAgICAvLyBHZXQgdGhlIGludGVnZXIgcGFydCBvZiBzYW1wbGVzRGVsYXlcbiAgICAgICAgICAgIHRoaXMuaW50RGVsYXkgPSBwYXJzZUludChzYW1wbGVzRGVsYXkpO1xuICAgICAgICAgICAgLy8gR2V0IHRoZSBmcmFjdGlvbmFsIHBhcnQgb2Ygc2FtcGxlc0RlbGF5XG4gICAgICAgICAgICB0aGlzLmZyYWNEZWxheSA9IHNhbXBsZXNEZWxheSAtIHRoaXMuaW50RGVsYXk7XG4gICAgICAgICAgICAvLyBVcGRhdGUgdGhlIHZhbHVlIG9mIHRoZSBwb2ludGVyXG4gICAgICAgICAgICB0aGlzLnJlc2FtcGxlKCk7XG4gICAgICAgICAgICAvLyBJZiB0aGUgZGVsYXkgaGFzIGZyYWN0aW9uYWwgcGFydCwgdXBkYXRlIHRoZSBUaGlyYW4gQ29lZmZpY2llbnRzXG4gICAgICAgICAgICBpZiAodGhpcy5mcmFjRGVsYXkgIT09IDApIHtcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZVRoaXJhbkNvZWZmaWNpZW50KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJkZWxheVRpbWUgPiBtYXhEZWxheVRpbWVcIik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBVcGRhdGUgZGVsYXkgdmFsdWVcbiAgICAgKiBAcHVibGljXG4gICAgICovXG4gICAgZ2V0RGVsYXkoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmRlbGF5VGltZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQcm9jZXNzIG1ldGhvZCwgd2hlcmUgdGhlIG91dHB1dCBpcyBjYWxjdWxhdGVkLlxuICAgICAqIEBwYXJhbSBpbnB1dEJ1ZmZlciBJbnB1dCBBcnJheVxuICAgICAqIEBwdWJsaWNcbiAgICAgKi9cbiAgICBwcm9jZXNzKGlucHV0QnVmZmVyKSB7XG4gICAgICAgIC8vIENyZWF0ZXMgdGhlIG91dHB1dEJ1ZmZlciwgd2l0aCB0aGUgc2FtZSBsZW5ndGggb2YgdGhlIGlucHV0XG4gICAgICAgIHZhciBvdXRwdXRCdWZmZXIgPSBuZXcgRmxvYXQzMkFycmF5KGlucHV0QnVmZmVyLmxlbmd0aCk7XG5cbiAgICAgICAgLy8gSW50ZWdlciBkZWxheSBwcm9jZXNzIHNlY3Rpb25cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBpbnB1dEJ1ZmZlci5sZW5ndGg7IGkgPSBpICsgMSkge1xuICAgICAgICAgICAgLy8gU2F2ZSB0aGUgaW5wdXQgdmFsdWUgaW4gdGhlIGJ1ZmZlclxuICAgICAgICAgICAgdGhpcy5idWZmZXJbdGhpcy5wb3NXcml0ZV0gPSBpbnB1dEJ1ZmZlcltpXTtcbiAgICAgICAgICAgIC8vIFdyaXRlIHRoZSBvdXRwdXRCdWZmZXIgd2l0aCB0aGUgW2lucHV0VmFsdWUgLSBkZWxheV0gc2FtcGxlXG4gICAgICAgICAgICBvdXRwdXRCdWZmZXJbaV0gPSB0aGlzLmJ1ZmZlclt0aGlzLnBvc1JlYWRdO1xuICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSB2YWx1ZSBvZiBwb3NSZWFkIGFuZCBwb3NXcml0ZSBwb2ludGVyc1xuICAgICAgICAgICAgdGhpcy51cGRhdGVQb2ludGVycygpO1xuICAgICAgICB9XG4gICAgICAgIC8vIE5vIGZyYWN0aW9uYWwgZGVsYXlcbiAgICAgICAgaWYgKHRoaXMuZnJhY0RlbGF5ID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm4gb3V0cHV0QnVmZmVyO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gVGhlIGZyYWN0aW9uYWwgZGVsYXkgcHJvY2VzcyBzZWN0aW9uXG4gICAgICAgICAgICBvdXRwdXRCdWZmZXIgPSBuZXcgRmxvYXQzMkFycmF5KHRoaXMuZnJhY3Rpb25hbFRoaXJhblByb2Nlc3Mob3V0cHV0QnVmZmVyKSk7XG4gICAgICAgICAgICByZXR1cm4gb3V0cHV0QnVmZmVyO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVXBkYXRlIHRoZSB2YWx1ZSBvZiBwb3NSZWFkIGFuZCBwb3NXcml0ZSBwb2ludGVycyBpbnNpZGUgdGhlIGNpcmN1bGFyIGJ1ZmZlclxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgdXBkYXRlUG9pbnRlcnMoKSB7XG4gICAgICAgIC8vIEl0J3MgYSBjaXJjdWxhciBidWZmZXIsIHNvLCB3aGVuIGl0IGlzIGF0IHRoZSBsYXN0IHBvc2l0aW9uLCB0aGUgcG9pbnRlciByZXR1cm4gdG8gdGhlIGZpcnN0IHBvc2l0aW9uXG5cbiAgICAgICAgLy8gVXBkYXRlIHBvc1dyaXRlIHBvaW50ZXJcbiAgICAgICAgaWYgKHRoaXMucG9zV3JpdGUgPT09ICh0aGlzLmJ1ZmZlci5sZW5ndGggLSAxKSkge1xuICAgICAgICAgICAgdGhpcy5wb3NXcml0ZSA9IDA7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLnBvc1dyaXRlID0gdGhpcy5wb3NXcml0ZSArIDE7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBVcGRhdGUgcG9zUmVhZCBwb2ludGVyXG4gICAgICAgIGlmICh0aGlzLnBvc1JlYWQgPT09ICh0aGlzLmJ1ZmZlci5sZW5ndGggLSAxKSkge1xuICAgICAgICAgICAgdGhpcy5wb3NSZWFkID0gMDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMucG9zUmVhZCA9IHRoaXMucG9zUmVhZCArIDE7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBVcGRhdGUgVGhpcmFuIGNvZWZmaWNpZW50ICgxc3Qgb3JkZXIgVGhpcmFuKVxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgdXBkYXRlVGhpcmFuQ29lZmZpY2llbnQoKSB7XG4gICAgICAgIC8vIFVwZGF0ZSB0aGUgY29lZmZpY2llbnQ6ICgxLUQpLygxK0QpIHdoZXJlIEQgaXMgZnJhY3Rpb25hbCBkZWxheVxuICAgICAgICB0aGlzLmExID0gKDEgLSB0aGlzLmZyYWNEZWxheSkgLyAoMSArIHRoaXMuZnJhY0RlbGF5KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBVcGRhdGUgdGhlIHBvaW50ZXIgcG9zUmVhZCB2YWx1ZSB3aGVuIHRoZSBkZWxheSB2YWx1ZSBpcyBjaGFuZ2VkXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICByZXNhbXBsZSgpIHtcbiAgICAgICAgaWYgKHRoaXMucG9zV3JpdGUgLSB0aGlzLmludERlbGF5IDwgMCkge1xuICAgICAgICAgICAgdmFyIHBvcyA9IHRoaXMuaW50RGVsYXkgLSB0aGlzLnBvc1dyaXRlO1xuICAgICAgICAgICAgdGhpcy5wb3NSZWFkID0gdGhpcy5idWZmZXIubGVuZ3RoIC0gcG9zO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5wb3NSZWFkID0gdGhpcy5wb3NXcml0ZSAtIHRoaXMuaW50RGVsYXk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBGcmFjdGlvbmFsIHByb2Nlc3MgbWV0aG9kLlxuICAgICAqIEBwcml2YXRlXG4gICAgICogQHBhcmFtIGlucHV0QnVmZmVyIElucHV0IEFycmF5XG4gICAgICovXG4gICAgZnJhY3Rpb25hbFRoaXJhblByb2Nlc3MoaW5wdXRCdWZmZXIpIHtcbiAgICAgICAgdmFyIG91dHB1dEJ1ZmZlciA9IG5ldyBGbG9hdDMyQXJyYXkoaW5wdXRCdWZmZXIubGVuZ3RoKTtcblxuICAgICAgICB2YXIgeCwgeTtcbiAgICAgICAgdmFyIHhpMSA9IHRoaXMuZnJhY1hpMTtcbiAgICAgICAgdmFyIHlpMSA9IHRoaXMuZnJhY1lpMTtcblxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGlucHV0QnVmZmVyLmxlbmd0aDsgaSA9IGkgKyAxKSB7XG4gICAgICAgICAgICAvLyBDdXJyZW50IGlucHV0IHNhbXBsZVxuICAgICAgICAgICAgeCA9IGlucHV0QnVmZmVyW2ldO1xuXG4gICAgICAgICAgICAvLyBDYWxjdWxhdGUgdGhlIG91dHB1dFxuICAgICAgICAgICAgeSA9IHRoaXMuYTEgKiB4ICsgeGkxIC0gdGhpcy5hMSAqIHlpMTtcblxuICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSBtZW1vcmllc1xuICAgICAgICAgICAgeGkxID0geDtcbiAgICAgICAgICAgIHlpMSA9IHk7XG4gICAgICAgICAgICAvLyBTYXZlIHRoZSBvdXRwdXRCdWZmZXJcbiAgICAgICAgICAgIG91dHB1dEJ1ZmZlcltpXSA9IHk7XG5cbiAgICAgICAgfVxuICAgICAgICAvLyBTYXZlIG1lbW9yaWVzXG4gICAgICAgIHRoaXMuZnJhY1hpMSA9IHhpMTtcbiAgICAgICAgdGhpcy5mcmFjWWkxID0geWkxO1xuXG4gICAgICAgIHJldHVybiBvdXRwdXRCdWZmZXI7XG4gICAgfVxufVxuIiwibW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2Rpc3QvZnJhY3Rpb25hbC1kZWxheScpO1xuIl19
