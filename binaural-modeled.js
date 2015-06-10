!function(e){if("object"==typeof exports)module.exports=e();else if("function"==typeof define&&define.amd)define(e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.BinauralModeled=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
"use strict";
var kdt = _dereq_('kdt');
var BiquadFilter = _dereq_("biquad-filter");
var FractionalDelay = _dereq_("fractional-delay");
var BinauralModeled = function BinauralModeled(options) {
  this.audioContext = options.audioContext;
  this.hrtfDataset = undefined;
  this.hrtfDatasetLength = undefined;
  this.nextPosition = [];
  this.changeWhenFinishCrossfading = false;
  this.position = [];
  this.crossfadeDuration = 20 / 1000;
  this.bufferSize = 1024;
  this.tree = -1;
  this.input = this.audioContext.createGain();
  this.mainAudioGraph = new ProcessingAudioGraph({audioContext: this.audioContext});
  this.mainAudioGraph.gain.value = 1;
  this.input.connect(this.mainAudioGraph.input);
  this.secondaryAudioGraph = new ProcessingAudioGraph({audioContext: this.audioContext});
  this.secondaryAudioGraph.gain.value = 0;
  this.input.connect(this.secondaryAudioGraph.input);
  this.sampleRate = this.audioContext.sampleRate;
  this.input.connect(this.mainAudioGraph.input);
  this.input.connect(this.secondaryAudioGraph.input);
};
($traceurRuntime.createClass)(BinauralModeled, {
  connect: function(node) {
    this.mainAudioGraph.connect(node);
    this.secondaryAudioGraph.connect(node);
    return this;
  },
  disconnect: function(node) {
    this.mainAudioGraph.disconnect(node);
    this.secondaryAudioGraph.disconnect(node);
    return this;
  },
  set HRTFDataset(hrtfDataset) {
    this.hrtfDataset = hrtfDataset;
    this.hrtfDatasetLength = this.hrtfDataset.length;
    for (var i = 0; i < this.hrtfDatasetLength; i++) {
      var hrtf = this.hrtfDataset[i];
      var azimuthRadians = hrtf.azimuth * Math.PI / 180;
      var elevationRadians = hrtf.elevation * Math.PI / 180;
      var catesianCoord = this.sphericalToCartesian(azimuthRadians, elevationRadians, hrtf.distance);
      hrtf.x = catesianCoord.x;
      hrtf.y = catesianCoord.y;
      hrtf.z = catesianCoord.z;
    }
    this.tree = kdt.createKdTree(this.hrtfDataset, this.distance, ['x', 'y', 'z']);
    var hrtfNextPosition = this.getHRTF(0, 0, 1);
    this.secondaryAudioGraph.setCoefficients(hrtfNextPosition.iir_coeffs_left, hrtfNextPosition.iir_coeffs_right);
    this.secondaryAudioGraph.setDelay(hrtfNextPosition.itd / 1000);
    this.mainAudioGraph.setCoefficients(hrtfNextPosition.iir_coeffs_left, hrtfNextPosition.iir_coeffs_right);
    this.mainAudioGraph.setDelay(hrtfNextPosition.itd / 1000);
  },
  get HRTFDataset() {
    return this.hrtfDataset;
  },
  distance: function(a, b) {
    return Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + Math.pow(a.z - b.z, 2);
  },
  setLastPosition: function() {
    if (!this.isCrossfading()) {
      this.changeWhenFinishCrossfading = false;
      clearInterval(this.intervalID);
      this.reallyStartPosition();
    }
  },
  crossfading: function() {
    var now = this.audioContext.currentTime;
    this.mainAudioGraph.gain.setValueAtTime(1, now + 2 * this.bufferSize / this.sampleRate);
    this.mainAudioGraph.gain.linearRampToValueAtTime(0, now + this.crossfadeDuration + 2 * this.bufferSize / this.sampleRate);
    this.secondaryAudioGraph.gain.setValueAtTime(0, now + 2 * this.bufferSize / this.sampleRate);
    this.secondaryAudioGraph.gain.linearRampToValueAtTime(1, now + this.crossfadeDuration + 2 * this.bufferSize / this.sampleRate);
  },
  setPosition: function(azimuth, elevation, distance) {
    if (arguments.length === 3) {
      var nearestPosition = this.getRealCoordinates(azimuth, elevation, distance);
      if (nearestPosition.azimuth !== this.position.azimuth || nearestPosition.elevation !== this.position.elevation || nearestPosition.distance !== this.position.distance) {
        if (this.isCrossfading() === true) {
          if (this.changeWhenFinishCrossfading === true) {
            clearInterval(this.intervalID);
          } else {
            this.changeWhenFinishCrossfading = true;
          }
          this.nextPosition.azimuth = nearestPosition.azimuth;
          this.nextPosition.elevation = nearestPosition.elevation;
          this.nextPosition.distance = nearestPosition.distance;
          this.intervalID = window.setInterval(this.setLastPosition.bind(this), 0.005);
        } else {
          this.nextPosition.azimuth = nearestPosition.azimuth;
          this.nextPosition.elevation = nearestPosition.elevation;
          this.nextPosition.distance = nearestPosition.distance;
          this.reallyStartPosition();
        }
        return this;
      }
    }
  },
  reallyStartPosition: function() {
    this.position.azimuth = this.nextPosition.azimuth;
    this.position.elevation = this.nextPosition.elevation;
    this.position.distance = this.nextPosition.distance;
    var hrtfNextPosition = this.getHRTF(this.position.azimuth, this.position.elevation, this.position.distance);
    this.secondaryAudioGraph.setCoefficients(hrtfNextPosition.iir_coeffs_left, hrtfNextPosition.iir_coeffs_right);
    this.secondaryAudioGraph.setDelay(hrtfNextPosition.itd / 1000);
    this.crossfading();
    var active = this.mainAudioGraph;
    this.mainAudioGraph = this.secondaryAudioGraph;
    this.secondaryAudioGraph = active;
  },
  getPosition: function() {
    return this.position;
  },
  setCrossfadeDuration: function(msRamp) {
    this.crossfadeDuration = msRamp / 1000;
  },
  getCrossfadeDuration: function() {
    return crossfadeDuration * 1000;
  },
  isCrossfading: function() {
    if (this.mainAudioGraph.gain.value !== 1) {
      return true;
    } else {
      return false;
    }
  },
  getHRTF: function(azimuth, elevation, distance) {
    var nearest = this.getNearestPoint(azimuth, elevation, distance);
    var hrtf = [];
    hrtf.iir_coeffs_left = nearest.iir_coeffs_left;
    hrtf.iir_coeffs_right = nearest.iir_coeffs_right;
    hrtf.itd = nearest.itd;
    return hrtf;
  },
  sphericalToCartesian: function(azimuth, elevation, distance) {
    return {
      x: distance * Math.sin(azimuth),
      y: distance * Math.cos(azimuth),
      z: distance * Math.sin(elevation)
    };
  },
  getRealCoordinates: function(azimuth, elevation, distance) {
    var nearest = this.getNearestPoint(azimuth, elevation, distance);
    return {
      azimuth: nearest.azimuth,
      elevation: nearest.elevation,
      distance: nearest.distance
    };
  },
  getNearestPoint: function(azimuth, elevation, distance) {
    var azimuthRadians = azimuth * Math.PI / 180;
    var elevationRadians = elevation * Math.PI / 180;
    var cartesianCoord = this.sphericalToCartesian(azimuthRadians, elevationRadians, distance);
    var nearest = this.tree.nearest(cartesianCoord, 1)[0];
    return nearest[0];
  }
}, {});
;
var ProcessingAudioGraph = function ProcessingAudioGraph(options) {
  this.audioContext = options.audioContext;
  this.bufferSize = 1024;
  this.input = this.audioContext.createGain();
  this.gainNode = this.audioContext.createGain();
  this.biquadFilterLeft = new BiquadFilter();
  this.biquadFilterRight = new BiquadFilter();
  this.fractionalDelayLeft = new FractionalDelay(44100);
  this.fractionalDelayRight = new FractionalDelay(44100);
  this.processorNode = this.audioContext.createScriptProcessor(this.bufferSize);
  this.input.connect(this.processorNode);
  this.processorNode.connect(this.gainNode);
  this.processorNodeFunction();
};
($traceurRuntime.createClass)(ProcessingAudioGraph, {
  get gain() {
    return this.gainNode.gain;
  },
  setCoefficients: function(leftCoefficients, rightCoefficients) {
    this.biquadFilterLeft.setCoefficients(leftCoefficients);
    this.biquadFilterRight.setCoefficients(rightCoefficients);
  },
  setDelay: function(delay) {
    var delayLeft = 1 / 1000 + delay / 2;
    var delayRight = 1 / 1000 - delay / 2;
    this.fractionalDelayLeft.setDelay(delayLeft);
    this.fractionalDelayRight.setDelay(delayRight);
  },
  processorNodeFunction: function() {
    var that = this;
    this.processorNode.onaudioprocess = function(e) {
      var inputArray = e.inputBuffer.getChannelData(0);
      var leftOutputArray = e.outputBuffer.getChannelData(0);
      var rightOutputArray = e.outputBuffer.getChannelData(1);
      var mediumArrayLeft = new Float32Array(that.fractionalDelayLeft.process(inputArray));
      var mediumArrayRight = new Float32Array(that.fractionalDelayRight.process(inputArray));
      that.biquadFilterLeft.process(mediumArrayLeft, leftOutputArray);
      that.biquadFilterRight.process(mediumArrayRight, rightOutputArray);
    };
  },
  connect: function(node) {
    this.gainNode.connect(node);
    return this;
  },
  disconnect: function(node) {
    this.gainNode.disconnect(node);
    return this;
  }
}, {});
module.exports = BinauralModeled;


//# sourceURL=/Users/goldszmidt/sam/pro/dev/binauralModeled/binaural-modeled.es6.js
},{"biquad-filter":2,"fractional-delay":3,"kdt":4}],2:[function(_dereq_,module,exports){
(function (global){
!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.BiquadFilter=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof _dereq_=="function"&&_dereq_;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof _dereq_=="function"&&_dereq_;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
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


}).call(this,typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],3:[function(_dereq_,module,exports){
(function (global){
!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.FractionalDelay=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof _dereq_=="function"&&_dereq_;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof _dereq_=="function"&&_dereq_;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
"use strict";
var FractionalDelay = function FractionalDelay(sampleRate, optMaxDelayTime) {
  this.delayTime = 0;
  this.maxDelayTime = 1;
  this.posRead = 0;
  this.posWrite = 0;
  this.fracXi1 = 0;
  this.fracYi1 = 0;
  this.intDelay = 0;
  this.fracDelay = 0;
  this.buffer = undefined;
  this.bufferSize = undefined;
  this.a1 = undefined;
  this.sampleRate = sampleRate;
  this.maxDelayTime = optMaxDelayTime || this.maxDelayTime;
  this.bufferSize = this.maxDelayTime * this.sampleRate;
  if (this.bufferSize % 1 !== 0) {
    this.bufferSize = parseInt(this.bufferSize) + 1;
  }
  this.buffer = new Float32Array(this.bufferSize);
  return this;
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
      console.log("throw error...how?");
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


}).call(this,typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],4:[function(_dereq_,module,exports){
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi9Vc2Vycy9nb2xkc3ptaWR0L3NhbS9wcm8vZGV2L2JpbmF1cmFsTW9kZWxlZC9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1wYWNrL19wcmVsdWRlLmpzIiwiL1VzZXJzL2dvbGRzem1pZHQvc2FtL3Byby9kZXYvYmluYXVyYWxNb2RlbGVkL2JpbmF1cmFsLW1vZGVsZWQuZXM2LmpzIiwiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL2xvY2FsL2xpYi9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1wYWNrL19wcmVsdWRlLmpzIiwiL1VzZXJzL2dvbGRzem1pZHQvc2FtL3Byby9kZXYvYmluYXVyYWxNb2RlbGVkL25vZGVfbW9kdWxlcy9rZHQvaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNNQTtBQUFBLEFBQUksRUFBQSxDQUFBLEdBQUUsRUFBSSxDQUFBLE9BQU0sQUFBQyxDQUFDLEtBQUksQ0FBQyxDQUFDO0FBQ3hCLEFBQUksRUFBQSxDQUFBLFlBQVcsRUFBSSxDQUFBLE9BQU0sQUFBQyxDQUFDLGVBQWMsQ0FBQyxDQUFDO0FBQzNDLEFBQUksRUFBQSxDQUFBLGVBQWMsRUFBSSxDQUFBLE9BQU0sQUFBQyxDQUFDLGtCQUFpQixDQUFDLENBQUM7QUFSakQsQUFBSSxFQUFBLGtCQWFKLFNBQU0sZ0JBQWMsQ0FPSixPQUFNLENBQUc7QUFDakIsS0FBRyxhQUFhLEVBQUksQ0FBQSxPQUFNLGFBQWEsQ0FBQztBQUV4QyxLQUFHLFlBQVksRUFBSSxVQUFRLENBQUM7QUFDNUIsS0FBRyxrQkFBa0IsRUFBSSxVQUFRLENBQUM7QUFDbEMsS0FBRyxhQUFhLEVBQUksR0FBQyxDQUFDO0FBQ3RCLEtBQUcsNEJBQTRCLEVBQUksTUFBSSxDQUFDO0FBQ3hDLEtBQUcsU0FBUyxFQUFJLEdBQUMsQ0FBQTtBQUNqQixLQUFHLGtCQUFrQixFQUFJLENBQUEsRUFBQyxFQUFJLEtBQUcs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O0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpfXZhciBmPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChmLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGYsZi5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKipcbiAqIEBmaWxlT3ZlcnZpZXdcbiAqXG4gKiBAYXV0aG9yIEFybmF1IEp1bGnDoCA8QXJuYXUuSnVsaWFAZ21haWwuY29tPlxuICogQHZlcnNpb24gMC4xLjBcbiAqL1xudmFyIGtkdCA9IHJlcXVpcmUoJ2tkdCcpO1xudmFyIEJpcXVhZEZpbHRlciA9IHJlcXVpcmUoXCJiaXF1YWQtZmlsdGVyXCIpO1xudmFyIEZyYWN0aW9uYWxEZWxheSA9IHJlcXVpcmUoXCJmcmFjdGlvbmFsLWRlbGF5XCIpO1xuXG4vKipcbiAqIEBjbGFzcyBCaW5hdXJhbE1vZGVsZWRcbiAqL1xuY2xhc3MgQmluYXVyYWxNb2RlbGVkIHtcblxuICAgIC8qKlxuICAgICAqIE1hbmRhdG9yeSBpbml0aWFsaXphdGlvbiBtZXRob2QuXG4gICAgICogQHB1YmxpY1xuICAgICAqIEBjaGFpbmFibGVcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3RvcihvcHRpb25zKSB7XG4gICAgICAgIHRoaXMuYXVkaW9Db250ZXh0ID0gb3B0aW9ucy5hdWRpb0NvbnRleHQ7XG4gICAgICAgIC8vIFByaXZhdGUgcHJvcGVydGllc1xuICAgICAgICB0aGlzLmhydGZEYXRhc2V0ID0gdW5kZWZpbmVkO1xuICAgICAgICB0aGlzLmhydGZEYXRhc2V0TGVuZ3RoID0gdW5kZWZpbmVkO1xuICAgICAgICB0aGlzLm5leHRQb3NpdGlvbiA9IFtdO1xuICAgICAgICB0aGlzLmNoYW5nZVdoZW5GaW5pc2hDcm9zc2ZhZGluZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLnBvc2l0aW9uID0gW11cbiAgICAgICAgdGhpcy5jcm9zc2ZhZGVEdXJhdGlvbiA9IDIwIC8gMTAwMFxuICAgICAgICB0aGlzLmJ1ZmZlclNpemUgPSAxMDI0O1xuICAgICAgICB0aGlzLnRyZWUgPSAtMTtcblxuICAgICAgICB0aGlzLmlucHV0ID0gdGhpcy5hdWRpb0NvbnRleHQuY3JlYXRlR2FpbigpO1xuXG4gICAgICAgIC8vIFR3byBzdWIgYXVkaW8gZ3JhcGhzIGNyZWF0aW9uOlxuICAgICAgICAvLyAtIG1haW5Db252b2x2ZXIgd2hpY2ggcmVwcmVzZW50cyB0aGUgY3VycmVudCBzdGF0ZVxuICAgICAgICAvLyAtIGFuZCBzZWNvbmRhcnlDb252b2x2ZXIgd2hpY2ggcmVwcmVzZW50cyB0aGUgcG90ZW50aWFsIHRhcmdldCBzdGF0ZVxuICAgICAgICAvLyAgIHdoZW4gbW92aW5nIHNvdW5kIHRvIGEgbmV3IHBvc2l0aW9uXG5cbiAgICAgICAgdGhpcy5tYWluQXVkaW9HcmFwaCA9IG5ldyBQcm9jZXNzaW5nQXVkaW9HcmFwaCh7YXVkaW9Db250ZXh0OiB0aGlzLmF1ZGlvQ29udGV4dH0pO1xuICAgICAgICB0aGlzLm1haW5BdWRpb0dyYXBoLmdhaW4udmFsdWUgPSAxO1xuICAgICAgICB0aGlzLmlucHV0LmNvbm5lY3QodGhpcy5tYWluQXVkaW9HcmFwaC5pbnB1dCk7XG5cbiAgICAgICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoID0gbmV3IFByb2Nlc3NpbmdBdWRpb0dyYXBoKHthdWRpb0NvbnRleHQ6IHRoaXMuYXVkaW9Db250ZXh0fSk7XG4gICAgICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5nYWluLnZhbHVlID0gMDtcbiAgICAgICAgdGhpcy5pbnB1dC5jb25uZWN0KHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5pbnB1dCk7XG4gICAgICAgIC8vIFdlYiBBdWRpb1xuICAgICAgICB0aGlzLnNhbXBsZVJhdGUgPSB0aGlzLmF1ZGlvQ29udGV4dC5zYW1wbGVSYXRlO1xuICAgICAgICAvL0Nvbm5lY3Rpb25zXG4gICAgICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLm1haW5BdWRpb0dyYXBoLmlucHV0KTtcbiAgICAgICAgdGhpcy5pbnB1dC5jb25uZWN0KHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5pbnB1dCk7XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBDb25uZWN0cyB0aGUgYmluYXVyYWxNb2RlbGVkTm9kZSB0byB0aGUgV2ViIEF1ZGlvIGdyYXBoXG4gICAgICogQHB1YmxpY1xuICAgICAqIEBjaGFpbmFibGVcbiAgICAgKiBAcGFyYW0gbm9kZSBEZXN0aW5hdGlvbiBub2RlXG4gICAgICovXG4gICAgY29ubmVjdChub2RlKSB7XG4gICAgICAgIHRoaXMubWFpbkF1ZGlvR3JhcGguY29ubmVjdChub2RlKTtcbiAgICAgICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLmNvbm5lY3Qobm9kZSk7XG4gICAgICAgIHJldHVybiB0aGlzOyAvLyBGb3IgY2hhaW5hYmlsaXR5XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBEaXNjb25uZWN0IHRoZSBiaW5hdXJhbE1vZGVsZWROb2RlIGZyb20gdGhlIFdlYiBBdWRpbyBncmFwaFxuICAgICAqIEBwdWJsaWNcbiAgICAgKiBAY2hhaW5hYmxlXG4gICAgICogQHBhcmFtIG5vZGUgRGVzdGluYXRpb24gbm9kZVxuICAgICAqL1xuICAgIGRpc2Nvbm5lY3Qobm9kZSkge1xuICAgICAgICB0aGlzLm1haW5BdWRpb0dyYXBoLmRpc2Nvbm5lY3Qobm9kZSk7XG4gICAgICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5kaXNjb25uZWN0KG5vZGUpO1xuICAgICAgICByZXR1cm4gdGhpczsgLy8gRm9yIGNoYWluYWJpbGl0eVxuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogU2V0IEhSVEYgRGF0YXNldCB0byBiZSB1c2VkIHdpdGggdGhlIHZpcnR1YWwgc291cmNlLlxuICAgICAqIEBwdWJsaWNcbiAgICAgKiBAY2hhaW5hYmxlXG4gICAgICogQHBhcmFtIGhydGZEYXRhc2V0IEFycmF5IG9mIE9iamVjdHMgY29udGFpbmluZyB0aGUgYXppbXV0aCwgZGlzdGFuY2UsIGVsZXZhdGlvbiwgdXJsIGFuZCBidWZmZXIgZm9yIGVhY2ggcG9pbnRcbiAgICAgKi9cbiAgICBzZXQgSFJURkRhdGFzZXQoaHJ0ZkRhdGFzZXQpIHtcbiAgICAgICAgdGhpcy5ocnRmRGF0YXNldCA9IGhydGZEYXRhc2V0O1xuICAgICAgICB0aGlzLmhydGZEYXRhc2V0TGVuZ3RoID0gdGhpcy5ocnRmRGF0YXNldC5sZW5ndGg7XG5cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLmhydGZEYXRhc2V0TGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBocnRmID0gdGhpcy5ocnRmRGF0YXNldFtpXTtcbiAgICAgICAgICAgIC8vIEF6aW11dGggYW5kIGVsZXZhdGlvbiB0byByYWRpYW5zXG4gICAgICAgICAgICB2YXIgYXppbXV0aFJhZGlhbnMgPSBocnRmLmF6aW11dGggKiBNYXRoLlBJIC8gMTgwO1xuICAgICAgICAgICAgdmFyIGVsZXZhdGlvblJhZGlhbnMgPSBocnRmLmVsZXZhdGlvbiAqIE1hdGguUEkgLyAxODA7XG4gICAgICAgICAgICB2YXIgY2F0ZXNpYW5Db29yZCA9IHRoaXMuc3BoZXJpY2FsVG9DYXJ0ZXNpYW4oYXppbXV0aFJhZGlhbnMsIGVsZXZhdGlvblJhZGlhbnMsIGhydGYuZGlzdGFuY2UpO1xuICAgICAgICAgICAgaHJ0Zi54ID0gY2F0ZXNpYW5Db29yZC54O1xuICAgICAgICAgICAgaHJ0Zi55ID0gY2F0ZXNpYW5Db29yZC55O1xuICAgICAgICAgICAgaHJ0Zi56ID0gY2F0ZXNpYW5Db29yZC56O1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudHJlZSA9IGtkdC5jcmVhdGVLZFRyZWUodGhpcy5ocnRmRGF0YXNldCwgdGhpcy5kaXN0YW5jZSwgWyd4JywgJ3knLCAneiddKTtcblxuICAgICAgICAvLyBQdXQgZGVmYXVsdCB2YWx1ZXNcbiAgICAgICAgdmFyIGhydGZOZXh0UG9zaXRpb24gPSB0aGlzLmdldEhSVEYoMCwgMCwgMSk7XG4gICAgICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5zZXRDb2VmZmljaWVudHMoaHJ0Zk5leHRQb3NpdGlvbi5paXJfY29lZmZzX2xlZnQsIGhydGZOZXh0UG9zaXRpb24uaWlyX2NvZWZmc19yaWdodCk7XG4gICAgICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5zZXREZWxheShocnRmTmV4dFBvc2l0aW9uLml0ZCAvIDEwMDApO1xuICAgICAgICB0aGlzLm1haW5BdWRpb0dyYXBoLnNldENvZWZmaWNpZW50cyhocnRmTmV4dFBvc2l0aW9uLmlpcl9jb2VmZnNfbGVmdCwgaHJ0Zk5leHRQb3NpdGlvbi5paXJfY29lZmZzX3JpZ2h0KTtcbiAgICAgICAgdGhpcy5tYWluQXVkaW9HcmFwaC5zZXREZWxheShocnRmTmV4dFBvc2l0aW9uLml0ZCAvIDEwMDApO1xuICAgIH1cbiAgICBnZXQgSFJURkRhdGFzZXQoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmhydGZEYXRhc2V0O1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogQ2FsY3VsYXRlIHRoZSBkaXN0YW5jZSBiZXR3ZWVuIHR3byBwb2ludHMgaW4gYSAzLUQgc3BhY2UuXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAY2hhaW5hYmxlXG4gICAgICogQHBhcmFtIGEgT2JqZWN0IGNvbnRhaW5pbmcgdGhyZWUgcHJvcGVydGllczogeCwgeSwgelxuICAgICAqIEBwYXJhbSBiIE9iamVjdCBjb250YWluaW5nIHRocmVlIHByb3BlcnRpZXM6IHgsIHksIHpcbiAgICAgKi9cbiAgICBkaXN0YW5jZShhLCBiKSB7XG4gICAgICAgIC8vIE5vIG5lZWQgdG8gY29tcHV0ZSBzcXVhcmUgcm9vdCBoZXJlIGZvciBkaXN0YW5jZSBjb21wYXJpc29uLCB0aGlzIGlzIG1vcmUgZWZpY2llbnQuXG4gICAgICAgIHJldHVybiBNYXRoLnBvdyhhLnggLSBiLngsIDIpICsgTWF0aC5wb3coYS55IC0gYi55LCAyKSArIE1hdGgucG93KGEueiAtIGIueiwgMik7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2V0IGdhaW4gdmFsdWUgYW5kIHNxdWFyZWQgdm9sdW1lLlxuICAgICAqIEBwcml2YXRlXG4gICAgICogQGNoYWluYWJsZVxuICAgICAqIEB0b2RvIDogcmVhbG1lbnQgdmEgYXF1w60gYWl4w7I/XG4gICAgICovXG4gICAgc2V0TGFzdFBvc2l0aW9uKCkge1xuICAgICAgICBpZiAoIXRoaXMuaXNDcm9zc2ZhZGluZygpKSB7XG4gICAgICAgICAgICB0aGlzLmNoYW5nZVdoZW5GaW5pc2hDcm9zc2ZhZGluZyA9IGZhbHNlO1xuICAgICAgICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLmludGVydmFsSUQpO1xuICAgICAgICAgICAgdGhpcy5yZWFsbHlTdGFydFBvc2l0aW9uKCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcm9zc2ZhZGluZ1xuICAgICAqIEBwcml2YXRlXG4gICAgICogQGNoYWluYWJsZVxuICAgICAqL1xuICAgIGNyb3NzZmFkaW5nKCkge1xuICAgICAgICAvLyBEbyB0aGUgY3Jvc3NmYWRpbmcgYmV0d2VlbiBtYWluQXVkaW9HcmFwaCBhbmQgc2Vjb25kYXJ5QXVkaW9HcmFwaFxuICAgICAgICB2YXIgbm93ID0gdGhpcy5hdWRpb0NvbnRleHQuY3VycmVudFRpbWU7XG4gICAgICAgIC8vIFdhaXQgdHdvIGJ1ZmZlcnMgdW50aWwgZG8gdGhlIGNoYW5nZSAoc2NyaXB0UHJvY2Vzc29yTm9kZSBvbmx5IHVwZGF0ZSB0aGUgdmFyaWFibGVzIGF0IHRoZSBmaXJzdCBzYW1wbGUgb2YgdGhlIGJ1ZmZlcilcbiAgICAgICAgdGhpcy5tYWluQXVkaW9HcmFwaC5nYWluLnNldFZhbHVlQXRUaW1lKDEsIG5vdyArIDIgKiB0aGlzLmJ1ZmZlclNpemUgLyB0aGlzLnNhbXBsZVJhdGUpO1xuICAgICAgICB0aGlzLm1haW5BdWRpb0dyYXBoLmdhaW4ubGluZWFyUmFtcFRvVmFsdWVBdFRpbWUoMCwgbm93ICsgdGhpcy5jcm9zc2ZhZGVEdXJhdGlvbiArIDIgKiB0aGlzLmJ1ZmZlclNpemUgLyB0aGlzLnNhbXBsZVJhdGUpO1xuXG4gICAgICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5nYWluLnNldFZhbHVlQXRUaW1lKDAsIG5vdyArIDIgKiB0aGlzLmJ1ZmZlclNpemUgLyB0aGlzLnNhbXBsZVJhdGUpO1xuICAgICAgICB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguZ2Fpbi5saW5lYXJSYW1wVG9WYWx1ZUF0VGltZSgxLCBub3cgKyB0aGlzLmNyb3NzZmFkZUR1cmF0aW9uICsgMiAqIHRoaXMuYnVmZmVyU2l6ZSAvIHRoaXMuc2FtcGxlUmF0ZSk7XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBTZXQgcG9zaXRpb24gb2YgdGhlIHZpcnR1YWwgc291cmNlXG4gICAgICogQHB1YmxpY1xuICAgICAqIEBjaGFpbmFibGVcbiAgICAgKiBAcGFyYW0gYXppbXV0aCBBemltdXRoIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIC0xODAgZm9yIHNvdXJjZSBvbiB5b3VyIGxlZnQsIGFuZCBmcm9tIDAgdG8gMTgwIGZvciBzb3VyY2Ugb24geW91ciByaWdodFxuICAgICAqIEBwYXJhbSBlbGV2YXRpb24gRWxldmF0aW9uIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIDkwIGZvciBzb3VyY2UgYWJvdmUgeW91ciBoZWFkLCAwIGZvciBzb3VyY2UgaW4gZnJvbnQgb2YgeW91ciBoZWFkLCBhbmQgZnJvbSAwIHRvIC05MCBmb3Igc291cmNlIGJlbG93IHlvdXIgaGVhZClcbiAgICAgKiBAcGFyYW0gZGlzdGFuY2UgRGlzdGFuY2UgaW4gbWV0ZXJzXG4gICAgICovXG4gICAgc2V0UG9zaXRpb24oYXppbXV0aCwgZWxldmF0aW9uLCBkaXN0YW5jZSkge1xuXG4gICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAzKSB7XG4gICAgICAgICAgICAvLyBDYWxjdWxhdGUgdGhlIG5lYXJlc3QgcG9zaXRpb24gZm9yIHRoZSBpbnB1dCBhemltdXRoLCBlbGV2YXRpb24gYW5kIGRpc3RhbmNlXG4gICAgICAgICAgICB2YXIgbmVhcmVzdFBvc2l0aW9uID0gdGhpcy5nZXRSZWFsQ29vcmRpbmF0ZXMoYXppbXV0aCwgZWxldmF0aW9uLCBkaXN0YW5jZSk7XG4gICAgICAgICAgICAvLyBObyBuZWVkIHRvIGNoYW5nZSB0aGUgY3VycmVudCBIUlRGIGxvYWRlZCBpZiBzZXR0ZWQgcG9zaXRpb24gZXF1YWwgY3VycmVudCBwb3NpdGlvblxuICAgICAgICAgICAgaWYgKG5lYXJlc3RQb3NpdGlvbi5hemltdXRoICE9PSB0aGlzLnBvc2l0aW9uLmF6aW11dGggfHwgbmVhcmVzdFBvc2l0aW9uLmVsZXZhdGlvbiAhPT0gdGhpcy5wb3NpdGlvbi5lbGV2YXRpb24gfHwgbmVhcmVzdFBvc2l0aW9uLmRpc3RhbmNlICE9PSB0aGlzLnBvc2l0aW9uLmRpc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIGNyb3NzZmFkaW5nIGlzIGFjdGl2ZVxuICAgICAgICAgICAgICAgIGlmICh0aGlzLmlzQ3Jvc3NmYWRpbmcoKSA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiB0aGVyZSBpcyBhIHZhbHVlIHdhaXRpbmcgdG8gYmUgc2V0XG4gICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLmNoYW5nZVdoZW5GaW5pc2hDcm9zc2ZhZGluZyA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gU3RvcCB0aGUgcGFzdCBzZXRJbnRlcnZhbCBldmVudC5cbiAgICAgICAgICAgICAgICAgICAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5pbnRlcnZhbElEKTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY2hhbmdlV2hlbkZpbmlzaENyb3NzZmFkaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIC8vIFNhdmUgdGhlIHBvc2l0aW9uXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubmV4dFBvc2l0aW9uLmF6aW11dGggPSBuZWFyZXN0UG9zaXRpb24uYXppbXV0aDtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5uZXh0UG9zaXRpb24uZWxldmF0aW9uID0gbmVhcmVzdFBvc2l0aW9uLmVsZXZhdGlvbjtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5uZXh0UG9zaXRpb24uZGlzdGFuY2UgPSBuZWFyZXN0UG9zaXRpb24uZGlzdGFuY2U7XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gU3RhcnQgdGhlIHNldEludGVydmFsOiB3YWl0IHVudGlsIHRoZSBjcm9zc2ZhZGluZyBpcyBmaW5pc2hlZC5cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5pbnRlcnZhbElEID0gd2luZG93LnNldEludGVydmFsKHRoaXMuc2V0TGFzdFBvc2l0aW9uLmJpbmQodGhpcyksIDAuMDA1KTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm5leHRQb3NpdGlvbi5hemltdXRoID0gbmVhcmVzdFBvc2l0aW9uLmF6aW11dGg7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubmV4dFBvc2l0aW9uLmVsZXZhdGlvbiA9IG5lYXJlc3RQb3NpdGlvbi5lbGV2YXRpb247XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubmV4dFBvc2l0aW9uLmRpc3RhbmNlID0gbmVhcmVzdFBvc2l0aW9uLmRpc3RhbmNlO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlYWxseVN0YXJ0UG9zaXRpb24oKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXM7IC8vIEZvciBjaGFpbmFiaWxpdHlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogUmVhbGx5IGNoYW5nZSB0aGUgcG9zaXRpb25cbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHJlYWxseVN0YXJ0UG9zaXRpb24oKSB7XG4gICAgICAgIC8vIFNhdmUgdGhlIGN1cnJlbnQgcG9zaXRpb25cbiAgICAgICAgdGhpcy5wb3NpdGlvbi5hemltdXRoID0gdGhpcy5uZXh0UG9zaXRpb24uYXppbXV0aDtcbiAgICAgICAgdGhpcy5wb3NpdGlvbi5lbGV2YXRpb24gPSB0aGlzLm5leHRQb3NpdGlvbi5lbGV2YXRpb247XG4gICAgICAgIHRoaXMucG9zaXRpb24uZGlzdGFuY2UgPSB0aGlzLm5leHRQb3NpdGlvbi5kaXN0YW5jZTtcblxuICAgICAgICB2YXIgaHJ0Zk5leHRQb3NpdGlvbiA9IHRoaXMuZ2V0SFJURih0aGlzLnBvc2l0aW9uLmF6aW11dGgsIHRoaXMucG9zaXRpb24uZWxldmF0aW9uLCB0aGlzLnBvc2l0aW9uLmRpc3RhbmNlKTtcbiAgICAgICAgLy8gTG9hZCB0aGUgbmV3IHBvc2l0aW9uIGluIHRoZSBiaXF1YWQgYW5kIGRlbGF5IG5vdCBhY3RpdmUgKHNlY29uZGFyeUF1ZGlvR3JhcGgpXG4gICAgICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5zZXRDb2VmZmljaWVudHMoaHJ0Zk5leHRQb3NpdGlvbi5paXJfY29lZmZzX2xlZnQsIGhydGZOZXh0UG9zaXRpb24uaWlyX2NvZWZmc19yaWdodCk7XG4gICAgICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5zZXREZWxheShocnRmTmV4dFBvc2l0aW9uLml0ZCAvIDEwMDApO1xuXG4gICAgICAgIC8vIERvIHRoZSBjcm9zc2ZhZGluZyBiZXR3ZWVuIG1haW5BdWRpb0dyYXBoIGFuZCBzZWNvbmRhcnlBdWRpb0dyYXBoXG4gICAgICAgIHRoaXMuY3Jvc3NmYWRpbmcoKTtcblxuICAgICAgICAvLyBDaGFuZ2UgY3VycmVudCBtYWluQXVkaW9HcmFwaFxuICAgICAgICB2YXIgYWN0aXZlID0gdGhpcy5tYWluQXVkaW9HcmFwaDtcbiAgICAgICAgdGhpcy5tYWluQXVkaW9HcmFwaCA9IHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaDtcbiAgICAgICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoID0gYWN0aXZlO1xuXG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIGN1cnJlbnQgcG9zaXRpb24gb2YgdGhlIHZpcnR1YWwgc291cmNlLlxuICAgICAqIEBwdWJsaWNcbiAgICAgKi9cbiAgICBnZXRQb3NpdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucG9zaXRpb247XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBQYXVzZSBwbGF5aW5nLlxuICAgICAqIEBwdWJsaWNcbiAgICAgKi9cbiAgICBzZXRDcm9zc2ZhZGVEdXJhdGlvbihtc1JhbXApIHtcbiAgICAgICAgLy9zYXZlIGluIHNlY29uZHNcbiAgICAgICAgdGhpcy5jcm9zc2ZhZGVEdXJhdGlvbiA9IG1zUmFtcCAvIDEwMDA7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2VlayBidWZmZXIgcG9zaXRpb24gKGluIHNlYykuXG4gICAgICogQHB1YmxpY1xuICAgICAqL1xuICAgIGdldENyb3NzZmFkZUR1cmF0aW9uKCkge1xuICAgICAgICAvL3JldHVybiBpbiBtc1xuICAgICAgICByZXR1cm4gY3Jvc3NmYWRlRHVyYXRpb24gKiAxMDAwO1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogUmVsZWFzZSBwbGF5aW5nIGZsYWcgd2hlbiB0aGUgZW5kIG9mIHRoZSBidWZmZXIgaXMgcmVhY2hlZC5cbiAgICAgKiBAcHVibGljXG4gICAgICogQHRvZG8gSGFuZGxlIHNwZWVkIGNoYW5nZXMuXG4gICAgICovXG4gICAgaXNDcm9zc2ZhZGluZygpIHtcbiAgICAgICAgLy8gVGhlIHJhbXBzIGFyZSBub3QgZmluaXNoZWQsIHNvIHRoZSBjcm9zc2ZhZGluZyBpcyBub3QgZmluaXNoZWRcbiAgICAgICAgaWYgKHRoaXMubWFpbkF1ZGlvR3JhcGguZ2Fpbi52YWx1ZSAhPT0gMSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgSFJURiBmaWxlIGZvciBhbiBlc3BlY2lmaWMgcG9zaXRpb25cbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqIEBwYXJhbSBhemltdXRoIEF6aW11dGggaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gLTE4MCBmb3Igc291cmNlIG9uIHlvdXIgbGVmdCwgYW5kIGZyb20gMCB0byAxODAgZm9yIHNvdXJjZSBvbiB5b3VyIHJpZ2h0XG4gICAgICogQHBhcmFtIGVsZXZhdGlvbiBFbGV2YXRpb24gaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gOTAgZm9yIHNvdXJjZSBhYm92ZSB5b3VyIGhlYWQsIDAgZm9yIHNvdXJjZSBpbiBmcm9udCBvZiB5b3VyIGhlYWQsIGFuZCBmcm9tIDAgdG8gLTkwIGZvciBzb3VyY2UgYmVsb3cgeW91ciBoZWFkKVxuICAgICAqIEBwYXJhbSBkaXN0YW5jZSBEaXN0YW5jZSBpbiBtZXRlcnNcbiAgICAgKi9cbiAgICBnZXRIUlRGKGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpIHtcbiAgICAgICAgdmFyIG5lYXJlc3QgPSB0aGlzLmdldE5lYXJlc3RQb2ludChhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKTtcbiAgICAgICAgdmFyIGhydGYgPSBbXTtcbiAgICAgICAgaHJ0Zi5paXJfY29lZmZzX2xlZnQgPSBuZWFyZXN0Lmlpcl9jb2VmZnNfbGVmdDtcbiAgICAgICAgaHJ0Zi5paXJfY29lZmZzX3JpZ2h0ID0gbmVhcmVzdC5paXJfY29lZmZzX3JpZ2h0O1xuICAgICAgICBocnRmLml0ZCA9IG5lYXJlc3QuaXRkO1xuXG4gICAgICAgIC8vIFJldHVybiBocnRmIGRhdGEgb2YgbmVhcmVzdCBwb3NpdGlvbiBmb3IgdGhlIGlucHV0IHZhbHVlc1xuICAgICAgICByZXR1cm4gaHJ0ZjtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBUcmFuc2Zvcm0gdGhlIHNwaGVyaWNhbCB0byBjYXJ0ZXNpYW4gY29vcmRpbmF0ZXMuXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAcGFyYW0gYXppbXV0aCBBemltdXRoIGluIHJhZGlhbnNcbiAgICAgKiBAcGFyYW0gZWxldmF0aW9uIEVsZXZhdGlvbiBpbiByYWRpYW5zXG4gICAgICogQHBhcmFtIGRpc3RhbmNlIERpc3RhbmNlIGluIG1ldGVyc1xuICAgICAqL1xuICAgIHNwaGVyaWNhbFRvQ2FydGVzaWFuKGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHg6IGRpc3RhbmNlICogTWF0aC5zaW4oYXppbXV0aCksXG4gICAgICAgICAgICB5OiBkaXN0YW5jZSAqIE1hdGguY29zKGF6aW11dGgpLFxuICAgICAgICAgICAgejogZGlzdGFuY2UgKiBNYXRoLnNpbihlbGV2YXRpb24pXG4gICAgICAgIH1cbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgbmVhcmVzdCBwb3NpdGlvbiBmb3IgYW4gaW5wdXQgcG9zaXRpb24uXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAcGFyYW0gYXppbXV0aCBBemltdXRoIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIC0xODAgZm9yIHNvdXJjZSBvbiB5b3VyIGxlZnQsIGFuZCBmcm9tIDAgdG8gMTgwIGZvciBzb3VyY2Ugb24geW91ciByaWdodFxuICAgICAqIEBwYXJhbSBlbGV2YXRpb24gRWxldmF0aW9uIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIDkwIGZvciBzb3VyY2UgYWJvdmUgeW91ciBoZWFkLCAwIGZvciBzb3VyY2UgaW4gZnJvbnQgb2YgeW91ciBoZWFkLCBhbmQgZnJvbSAwIHRvIC05MCBmb3Igc291cmNlIGJlbG93IHlvdXIgaGVhZClcbiAgICAgKiBAcGFyYW0gZGlzdGFuY2UgRGlzdGFuY2UgaW4gbWV0ZXJzXG4gICAgICovXG4gICAgZ2V0UmVhbENvb3JkaW5hdGVzKGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpIHtcbiAgICAgICAgdmFyIG5lYXJlc3QgPSB0aGlzLmdldE5lYXJlc3RQb2ludChhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKTtcbiAgICAgICAgLy8gUmV0dXJuIGF6aW11dGgsIGVsZXZhdGlvbiBhbmQgZGlzdGFuY2Ugb2YgbmVhcmVzdCBwb3NpdGlvbiBmb3IgdGhlIGlucHV0IHZhbHVlc1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgYXppbXV0aDogbmVhcmVzdC5hemltdXRoLFxuICAgICAgICAgICAgZWxldmF0aW9uOiBuZWFyZXN0LmVsZXZhdGlvbixcbiAgICAgICAgICAgIGRpc3RhbmNlOiBuZWFyZXN0LmRpc3RhbmNlXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIG5lYXJlc3QgcG9zaXRpb24gZm9yIGFuIGlucHV0IHBvc2l0aW9uLlxuICAgICAqIEBwcml2YXRlXG4gICAgICogQHBhcmFtIGF6aW11dGggQXppbXV0aCBpbiBkZWdyZWVzICjCsCk6IGZyb20gMCB0byAtMTgwIGZvciBzb3VyY2Ugb24geW91ciBsZWZ0LCBhbmQgZnJvbSAwIHRvIDE4MCBmb3Igc291cmNlIG9uIHlvdXIgcmlnaHRcbiAgICAgKiBAcGFyYW0gZWxldmF0aW9uIEVsZXZhdGlvbiBpbiBkZWdyZWVzICjCsCk6IGZyb20gMCB0byA5MCBmb3Igc291cmNlIGFib3ZlIHlvdXIgaGVhZCwgMCBmb3Igc291cmNlIGluIGZyb250IG9mIHlvdXIgaGVhZCwgYW5kIGZyb20gMCB0byAtOTAgZm9yIHNvdXJjZSBiZWxvdyB5b3VyIGhlYWQpXG4gICAgICogQHBhcmFtIGRpc3RhbmNlIERpc3RhbmNlIGluIG1ldGVyc1xuICAgICAqL1xuICAgIGdldE5lYXJlc3RQb2ludChhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKSB7XG4gICAgICAgIC8vIERlZ3JlZXMgdG8gcmFkaWFucyBmb3IgdGhlIGF6aW11dGggYW5kIGVsZXZhdGlvblxuICAgICAgICB2YXIgYXppbXV0aFJhZGlhbnMgPSBhemltdXRoICogTWF0aC5QSSAvIDE4MDtcbiAgICAgICAgdmFyIGVsZXZhdGlvblJhZGlhbnMgPSBlbGV2YXRpb24gKiBNYXRoLlBJIC8gMTgwO1xuICAgICAgICAvLyBDb252ZXJ0IHNwaGVyaWNhbCBjb29yZGluYXRlcyB0byBjYXJ0ZXNpYW5cbiAgICAgICAgdmFyIGNhcnRlc2lhbkNvb3JkID0gdGhpcy5zcGhlcmljYWxUb0NhcnRlc2lhbihhemltdXRoUmFkaWFucywgZWxldmF0aW9uUmFkaWFucywgZGlzdGFuY2UpO1xuICAgICAgICAvLyBHZXQgdGhlIG5lYXJlc3QgSFJURiBmaWxlIGZvciB0aGUgZGVzaXJlZCBwb3NpdGlvblxuICAgICAgICB2YXIgbmVhcmVzdCA9IHRoaXMudHJlZS5uZWFyZXN0KGNhcnRlc2lhbkNvb3JkLCAxKVswXTtcblxuICAgICAgICByZXR1cm4gbmVhcmVzdFswXTtcbiAgICB9XG5cblxufTtcblxuLyoqXG4gKiBBdWRpb0dyYXBoIHN1YiBhdWRpbyBncmFwaCBvYmplY3QgYXMgYW4gRUNNQVNjcmlwdDUgcHJvcGVydGllcyBvYmplY3QuXG4gKi9cblxuY2xhc3MgUHJvY2Vzc2luZ0F1ZGlvR3JhcGgge1xuXG5cbiAgICBjb25zdHJ1Y3RvcihvcHRpb25zKSB7XG4gICAgICAgIHRoaXMuYXVkaW9Db250ZXh0ID0gb3B0aW9ucy5hdWRpb0NvbnRleHQ7XG4gICAgICAgIC8vIFByaXZhdGUgcHJvcGVydGllc1xuICAgICAgICB0aGlzLmJ1ZmZlclNpemUgPSAxMDI0O1xuXG4gICAgICAgIC8vIENyZWF0aW9uc1xuICAgICAgICB0aGlzLmlucHV0ID0gdGhpcy5hdWRpb0NvbnRleHQuY3JlYXRlR2FpbigpO1xuICAgICAgICB0aGlzLmdhaW5Ob2RlID0gdGhpcy5hdWRpb0NvbnRleHQuY3JlYXRlR2FpbigpO1xuICAgICAgICB0aGlzLmJpcXVhZEZpbHRlckxlZnQgPSBuZXcgQmlxdWFkRmlsdGVyKCk7XG4gICAgICAgIHRoaXMuYmlxdWFkRmlsdGVyUmlnaHQgPSBuZXcgQmlxdWFkRmlsdGVyKCk7XG4gICAgICAgIHRoaXMuZnJhY3Rpb25hbERlbGF5TGVmdCA9IG5ldyBGcmFjdGlvbmFsRGVsYXkoNDQxMDApO1xuICAgICAgICB0aGlzLmZyYWN0aW9uYWxEZWxheVJpZ2h0ID0gbmV3IEZyYWN0aW9uYWxEZWxheSg0NDEwMCk7XG4gICAgICAgIHRoaXMucHJvY2Vzc29yTm9kZSA9IHRoaXMuYXVkaW9Db250ZXh0LmNyZWF0ZVNjcmlwdFByb2Nlc3Nvcih0aGlzLmJ1ZmZlclNpemUpO1xuICAgICAgICAvLyBDb25uZWN0aW9uc1xuICAgICAgICB0aGlzLmlucHV0LmNvbm5lY3QodGhpcy5wcm9jZXNzb3JOb2RlKTtcbiAgICAgICAgdGhpcy5wcm9jZXNzb3JOb2RlLmNvbm5lY3QodGhpcy5nYWluTm9kZSk7XG4gICAgICAgIC8vIFN0YXJ0IHByb2Nlc3Nvck5vZGVcbiAgICAgICAgdGhpcy5wcm9jZXNzb3JOb2RlRnVuY3Rpb24oKTtcbiAgICB9XG5cbiAgICBnZXQgZ2FpbigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2Fpbk5vZGUuZ2FpbjtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTZXQgY29lZmZpY2llbnRzIGJpcXVhZCBmaWx0ZXJcbiAgICAgKiBAcHVibGljXG4gICAgICogQHBhcmFtIHZhbHVlIEF1ZGlvQnVmZmVyIE9iamVjdC5cbiAgICAgKi9cbiAgICBzZXRDb2VmZmljaWVudHMobGVmdENvZWZmaWNpZW50cywgcmlnaHRDb2VmZmljaWVudHMpIHtcbiAgICAgICAgdGhpcy5iaXF1YWRGaWx0ZXJMZWZ0LnNldENvZWZmaWNpZW50cyhsZWZ0Q29lZmZpY2llbnRzKTtcbiAgICAgICAgdGhpcy5iaXF1YWRGaWx0ZXJSaWdodC5zZXRDb2VmZmljaWVudHMocmlnaHRDb2VmZmljaWVudHMpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNldCBidWZmZXIgYW5kIGJ1ZmZlckR1cmF0aW9uLlxuICAgICAqIEBwdWJsaWNcbiAgICAgKiBAY2hhaW5hYmxlXG4gICAgICovXG4gICAgc2V0RGVsYXkoZGVsYXkpIHtcbiAgICAgICAgdmFyIGRlbGF5TGVmdCA9IDEgLyAxMDAwICsgZGVsYXkgLyAyO1xuICAgICAgICB2YXIgZGVsYXlSaWdodCA9IDEgLyAxMDAwIC0gZGVsYXkgLyAyO1xuICAgICAgICB0aGlzLmZyYWN0aW9uYWxEZWxheUxlZnQuc2V0RGVsYXkoZGVsYXlMZWZ0KTtcbiAgICAgICAgdGhpcy5mcmFjdGlvbmFsRGVsYXlSaWdodC5zZXREZWxheShkZWxheVJpZ2h0KTtcbiAgICB9XG5cblxuICAgIHByb2Nlc3Nvck5vZGVGdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xuICAgICAgICB0aGlzLnByb2Nlc3Nvck5vZGUub25hdWRpb3Byb2Nlc3MgPSBmdW5jdGlvbihlKSB7XG4gICAgICAgICAgICAvLyBHZXQgdGhlIGlucHV0QnVmZmVyXG4gICAgICAgICAgICB2YXIgaW5wdXRBcnJheSA9IGUuaW5wdXRCdWZmZXIuZ2V0Q2hhbm5lbERhdGEoMCk7XG5cbiAgICAgICAgICAgIC8vIEdldCB0aGUgb3V0cHV0QnVmZmVyc1xuICAgICAgICAgICAgdmFyIGxlZnRPdXRwdXRBcnJheSA9IGUub3V0cHV0QnVmZmVyLmdldENoYW5uZWxEYXRhKDApO1xuICAgICAgICAgICAgdmFyIHJpZ2h0T3V0cHV0QXJyYXkgPSBlLm91dHB1dEJ1ZmZlci5nZXRDaGFubmVsRGF0YSgxKTtcblxuICAgICAgICAgICAgLy8gRGVsYXlcbiAgICAgICAgICAgIHZhciBtZWRpdW1BcnJheUxlZnQgPSBuZXcgRmxvYXQzMkFycmF5KHRoYXQuZnJhY3Rpb25hbERlbGF5TGVmdC5wcm9jZXNzKGlucHV0QXJyYXkpKTtcbiAgICAgICAgICAgIHZhciBtZWRpdW1BcnJheVJpZ2h0ID0gbmV3IEZsb2F0MzJBcnJheSh0aGF0LmZyYWN0aW9uYWxEZWxheVJpZ2h0LnByb2Nlc3MoaW5wdXRBcnJheSkpO1xuXG4gICAgICAgICAgICAvLyBCaXF1YWRGaWx0ZXJcbiAgICAgICAgICAgIHRoYXQuYmlxdWFkRmlsdGVyTGVmdC5wcm9jZXNzKG1lZGl1bUFycmF5TGVmdCwgbGVmdE91dHB1dEFycmF5KTtcbiAgICAgICAgICAgIHRoYXQuYmlxdWFkRmlsdGVyUmlnaHQucHJvY2VzcyhtZWRpdW1BcnJheVJpZ2h0LCByaWdodE91dHB1dEFycmF5KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENvbm5lY3QgdGhlIGNvbnZvbHZlckF1ZGlvR3JhcGggdG8gYSBub2RlXG4gICAgICogQHB1YmxpY1xuICAgICAqIEBjaGFpbmFibGVcbiAgICAgKiBAcGFyYW0gbm9kZSBEZXN0aW5hdGlvbiBub2RlXG4gICAgICovXG4gICAgY29ubmVjdChub2RlKSB7XG4gICAgICAgIHRoaXMuZ2Fpbk5vZGUuY29ubmVjdChub2RlKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGlzY29ubmVjdCB0aGUgY29udm9sdmVyQXVkaW9HcmFwaCB0byBhIG5vZGVcbiAgICAgKiBAcHVibGljXG4gICAgICogQGNoYWluYWJsZVxuICAgICAqIEBwYXJhbSBub2RlIERlc3RpbmF0aW9uIG5vZGVcbiAgICAgKi9cbiAgICBkaXNjb25uZWN0KG5vZGUpIHtcbiAgICAgICAgdGhpcy5nYWluTm9kZS5kaXNjb25uZWN0KG5vZGUpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cblxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IEJpbmF1cmFsTW9kZWxlZDtcbiIsIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLyoqXG4gKiBBVVRIT1IgT0YgSU5JVElBTCBKUyBMSUJSQVJZXG4gKiBrLWQgVHJlZSBKYXZhU2NyaXB0IC0gViAxLjBcbiAqXG4gKiBodHRwczovL2dpdGh1Yi5jb20vdWJpbGFicy9rZC10cmVlLWphdmFzY3JpcHRcbiAqXG4gKiBAYXV0aG9yIE1pcmNlYSBQcmljb3AgPHByaWNvcEB1YmlsYWJzLm5ldD4sIDIwMTJcbiAqIEBhdXRob3IgTWFydGluIEtsZXBwZSA8a2xlcHBlQHViaWxhYnMubmV0PiwgMjAxMlxuICogQGF1dGhvciBVYmlsYWJzIGh0dHA6Ly91YmlsYWJzLm5ldCwgMjAxMlxuICogQGxpY2Vuc2UgTUlUIExpY2Vuc2UgPGh0dHA6Ly93d3cub3BlbnNvdXJjZS5vcmcvbGljZW5zZXMvbWl0LWxpY2Vuc2UucGhwPlxuICovXG5cblxuZnVuY3Rpb24gTm9kZShvYmosIGRpbWVuc2lvbiwgcGFyZW50KSB7XG4gIHRoaXMub2JqID0gb2JqO1xuICB0aGlzLmxlZnQgPSBudWxsO1xuICB0aGlzLnJpZ2h0ID0gbnVsbDtcbiAgdGhpcy5wYXJlbnQgPSBwYXJlbnQ7XG4gIHRoaXMuZGltZW5zaW9uID0gZGltZW5zaW9uO1xufVxuXG5mdW5jdGlvbiBLZFRyZWUocG9pbnRzLCBtZXRyaWMsIGRpbWVuc2lvbnMpIHtcblxuICB2YXIgc2VsZiA9IHRoaXM7XG4gIFxuICBmdW5jdGlvbiBidWlsZFRyZWUocG9pbnRzLCBkZXB0aCwgcGFyZW50KSB7XG4gICAgdmFyIGRpbSA9IGRlcHRoICUgZGltZW5zaW9ucy5sZW5ndGgsXG4gICAgICBtZWRpYW4sXG4gICAgICBub2RlO1xuXG4gICAgaWYgKHBvaW50cy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBpZiAocG9pbnRzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgcmV0dXJuIG5ldyBOb2RlKHBvaW50c1swXSwgZGltLCBwYXJlbnQpO1xuICAgIH1cblxuICAgIHBvaW50cy5zb3J0KGZ1bmN0aW9uIChhLCBiKSB7XG4gICAgICByZXR1cm4gYVtkaW1lbnNpb25zW2RpbV1dIC0gYltkaW1lbnNpb25zW2RpbV1dO1xuICAgIH0pO1xuXG4gICAgbWVkaWFuID0gTWF0aC5mbG9vcihwb2ludHMubGVuZ3RoIC8gMik7XG4gICAgbm9kZSA9IG5ldyBOb2RlKHBvaW50c1ttZWRpYW5dLCBkaW0sIHBhcmVudCk7XG4gICAgbm9kZS5sZWZ0ID0gYnVpbGRUcmVlKHBvaW50cy5zbGljZSgwLCBtZWRpYW4pLCBkZXB0aCArIDEsIG5vZGUpO1xuICAgIG5vZGUucmlnaHQgPSBidWlsZFRyZWUocG9pbnRzLnNsaWNlKG1lZGlhbiArIDEpLCBkZXB0aCArIDEsIG5vZGUpO1xuXG4gICAgcmV0dXJuIG5vZGU7XG4gIH1cblxuICB0aGlzLnJvb3QgPSBidWlsZFRyZWUocG9pbnRzLCAwLCBudWxsKTtcblxuICB0aGlzLmluc2VydCA9IGZ1bmN0aW9uIChwb2ludCkge1xuICAgIGZ1bmN0aW9uIGlubmVyU2VhcmNoKG5vZGUsIHBhcmVudCkge1xuXG4gICAgICBpZiAobm9kZSA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gcGFyZW50O1xuICAgICAgfVxuXG4gICAgICB2YXIgZGltZW5zaW9uID0gZGltZW5zaW9uc1tub2RlLmRpbWVuc2lvbl07XG4gICAgICBpZiAocG9pbnRbZGltZW5zaW9uXSA8IG5vZGUub2JqW2RpbWVuc2lvbl0pIHtcbiAgICAgICAgcmV0dXJuIGlubmVyU2VhcmNoKG5vZGUubGVmdCwgbm9kZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gaW5uZXJTZWFyY2gobm9kZS5yaWdodCwgbm9kZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdmFyIGluc2VydFBvc2l0aW9uID0gaW5uZXJTZWFyY2godGhpcy5yb290LCBudWxsKSxcbiAgICAgIG5ld05vZGUsXG4gICAgICBkaW1lbnNpb247XG5cbiAgICBpZiAoaW5zZXJ0UG9zaXRpb24gPT09IG51bGwpIHtcbiAgICAgIHRoaXMucm9vdCA9IG5ldyBOb2RlKHBvaW50LCAwLCBudWxsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBuZXdOb2RlID0gbmV3IE5vZGUocG9pbnQsIChpbnNlcnRQb3NpdGlvbi5kaW1lbnNpb24gKyAxKSAlIGRpbWVuc2lvbnMubGVuZ3RoLCBpbnNlcnRQb3NpdGlvbik7XG4gICAgZGltZW5zaW9uID0gZGltZW5zaW9uc1tpbnNlcnRQb3NpdGlvbi5kaW1lbnNpb25dO1xuXG4gICAgaWYgKHBvaW50W2RpbWVuc2lvbl0gPCBpbnNlcnRQb3NpdGlvbi5vYmpbZGltZW5zaW9uXSkge1xuICAgICAgaW5zZXJ0UG9zaXRpb24ubGVmdCA9IG5ld05vZGU7XG4gICAgfSBlbHNlIHtcbiAgICAgIGluc2VydFBvc2l0aW9uLnJpZ2h0ID0gbmV3Tm9kZTtcbiAgICB9XG4gIH07XG5cbiAgdGhpcy5yZW1vdmUgPSBmdW5jdGlvbiAocG9pbnQpIHtcbiAgICB2YXIgbm9kZTtcblxuICAgIGZ1bmN0aW9uIG5vZGVTZWFyY2gobm9kZSkge1xuICAgICAgaWYgKG5vZGUgPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG5cbiAgICAgIGlmIChub2RlLm9iaiA9PT0gcG9pbnQpIHtcbiAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICB9XG5cbiAgICAgIHZhciBkaW1lbnNpb24gPSBkaW1lbnNpb25zW25vZGUuZGltZW5zaW9uXTtcblxuICAgICAgaWYgKHBvaW50W2RpbWVuc2lvbl0gPCBub2RlLm9ialtkaW1lbnNpb25dKSB7XG4gICAgICAgIHJldHVybiBub2RlU2VhcmNoKG5vZGUubGVmdCwgbm9kZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gbm9kZVNlYXJjaChub2RlLnJpZ2h0LCBub2RlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW1vdmVOb2RlKG5vZGUpIHtcbiAgICAgIHZhciBuZXh0Tm9kZSxcbiAgICAgICAgbmV4dE9iaixcbiAgICAgICAgcERpbWVuc2lvbjtcblxuICAgICAgZnVuY3Rpb24gZmluZE1heChub2RlLCBkaW0pIHtcbiAgICAgICAgdmFyIGRpbWVuc2lvbixcbiAgICAgICAgICBvd24sXG4gICAgICAgICAgbGVmdCxcbiAgICAgICAgICByaWdodCxcbiAgICAgICAgICBtYXg7XG5cbiAgICAgICAgaWYgKG5vZGUgPT09IG51bGwpIHtcbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGRpbWVuc2lvbiA9IGRpbWVuc2lvbnNbZGltXTtcbiAgICAgICAgaWYgKG5vZGUuZGltZW5zaW9uID09PSBkaW0pIHtcbiAgICAgICAgICBpZiAobm9kZS5yaWdodCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgcmV0dXJuIGZpbmRNYXgobm9kZS5yaWdodCwgZGltKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICAgIH1cblxuICAgICAgICBvd24gPSBub2RlLm9ialtkaW1lbnNpb25dO1xuICAgICAgICBsZWZ0ID0gZmluZE1heChub2RlLmxlZnQsIGRpbSk7XG4gICAgICAgIHJpZ2h0ID0gZmluZE1heChub2RlLnJpZ2h0LCBkaW0pO1xuICAgICAgICBtYXggPSBub2RlO1xuXG4gICAgICAgIGlmIChsZWZ0ICE9PSBudWxsICYmIGxlZnQub2JqW2RpbWVuc2lvbl0gPiBvd24pIHtcbiAgICAgICAgICBtYXggPSBsZWZ0O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHJpZ2h0ICE9PSBudWxsICYmIHJpZ2h0Lm9ialtkaW1lbnNpb25dID4gbWF4Lm9ialtkaW1lbnNpb25dKSB7XG4gICAgICAgICAgbWF4ID0gcmlnaHQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG1heDtcbiAgICAgIH1cblxuICAgICAgZnVuY3Rpb24gZmluZE1pbihub2RlLCBkaW0pIHtcbiAgICAgICAgdmFyIGRpbWVuc2lvbixcbiAgICAgICAgICBvd24sXG4gICAgICAgICAgbGVmdCxcbiAgICAgICAgICByaWdodCxcbiAgICAgICAgICBtaW47XG5cbiAgICAgICAgaWYgKG5vZGUgPT09IG51bGwpIHtcbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGRpbWVuc2lvbiA9IGRpbWVuc2lvbnNbZGltXTtcblxuICAgICAgICBpZiAobm9kZS5kaW1lbnNpb24gPT09IGRpbSkge1xuICAgICAgICAgIGlmIChub2RlLmxlZnQgIT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybiBmaW5kTWluKG5vZGUubGVmdCwgZGltKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICAgIH1cblxuICAgICAgICBvd24gPSBub2RlLm9ialtkaW1lbnNpb25dO1xuICAgICAgICBsZWZ0ID0gZmluZE1pbihub2RlLmxlZnQsIGRpbSk7XG4gICAgICAgIHJpZ2h0ID0gZmluZE1pbihub2RlLnJpZ2h0LCBkaW0pO1xuICAgICAgICBtaW4gPSBub2RlO1xuXG4gICAgICAgIGlmIChsZWZ0ICE9PSBudWxsICYmIGxlZnQub2JqW2RpbWVuc2lvbl0gPCBvd24pIHtcbiAgICAgICAgICBtaW4gPSBsZWZ0O1xuICAgICAgICB9XG4gICAgICAgIGlmIChyaWdodCAhPT0gbnVsbCAmJiByaWdodC5vYmpbZGltZW5zaW9uXSA8IG1pbi5vYmpbZGltZW5zaW9uXSkge1xuICAgICAgICAgIG1pbiA9IHJpZ2h0O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBtaW47XG4gICAgICB9XG5cbiAgICAgIGlmIChub2RlLmxlZnQgPT09IG51bGwgJiYgbm9kZS5yaWdodCA9PT0gbnVsbCkge1xuICAgICAgICBpZiAobm9kZS5wYXJlbnQgPT09IG51bGwpIHtcbiAgICAgICAgICBzZWxmLnJvb3QgPSBudWxsO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHBEaW1lbnNpb24gPSBkaW1lbnNpb25zW25vZGUucGFyZW50LmRpbWVuc2lvbl07XG5cbiAgICAgICAgaWYgKG5vZGUub2JqW3BEaW1lbnNpb25dIDwgbm9kZS5wYXJlbnQub2JqW3BEaW1lbnNpb25dKSB7XG4gICAgICAgICAgbm9kZS5wYXJlbnQubGVmdCA9IG51bGw7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbm9kZS5wYXJlbnQucmlnaHQgPSBudWxsO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKG5vZGUubGVmdCAhPT0gbnVsbCkge1xuICAgICAgICBuZXh0Tm9kZSA9IGZpbmRNYXgobm9kZS5sZWZ0LCBub2RlLmRpbWVuc2lvbik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBuZXh0Tm9kZSA9IGZpbmRNaW4obm9kZS5yaWdodCwgbm9kZS5kaW1lbnNpb24pO1xuICAgICAgfVxuXG4gICAgICBuZXh0T2JqID0gbmV4dE5vZGUub2JqO1xuICAgICAgcmVtb3ZlTm9kZShuZXh0Tm9kZSk7XG4gICAgICBub2RlLm9iaiA9IG5leHRPYmo7XG5cbiAgICB9XG5cbiAgICBub2RlID0gbm9kZVNlYXJjaChzZWxmLnJvb3QpO1xuXG4gICAgaWYgKG5vZGUgPT09IG51bGwpIHsgcmV0dXJuOyB9XG5cbiAgICByZW1vdmVOb2RlKG5vZGUpO1xuICB9O1xuXG4gIHRoaXMubmVhcmVzdCA9IGZ1bmN0aW9uIChwb2ludCwgbWF4Tm9kZXMsIG1heERpc3RhbmNlKSB7XG4gICAgdmFyIGksXG4gICAgICByZXN1bHQsXG4gICAgICBiZXN0Tm9kZXM7XG5cbiAgICBiZXN0Tm9kZXMgPSBuZXcgQmluYXJ5SGVhcChcbiAgICAgIGZ1bmN0aW9uIChlKSB7IHJldHVybiAtZVsxXTsgfVxuICAgICk7XG5cbiAgICBmdW5jdGlvbiBuZWFyZXN0U2VhcmNoKG5vZGUpIHtcbiAgICAgIHZhciBiZXN0Q2hpbGQsXG4gICAgICAgIGRpbWVuc2lvbiA9IGRpbWVuc2lvbnNbbm9kZS5kaW1lbnNpb25dLFxuICAgICAgICBvd25EaXN0YW5jZSA9IG1ldHJpYyhwb2ludCwgbm9kZS5vYmopLFxuICAgICAgICBsaW5lYXJQb2ludCA9IHt9LFxuICAgICAgICBsaW5lYXJEaXN0YW5jZSxcbiAgICAgICAgb3RoZXJDaGlsZCxcbiAgICAgICAgaTtcblxuICAgICAgZnVuY3Rpb24gc2F2ZU5vZGUobm9kZSwgZGlzdGFuY2UpIHtcbiAgICAgICAgYmVzdE5vZGVzLnB1c2goW25vZGUsIGRpc3RhbmNlXSk7XG4gICAgICAgIGlmIChiZXN0Tm9kZXMuc2l6ZSgpID4gbWF4Tm9kZXMpIHtcbiAgICAgICAgICBiZXN0Tm9kZXMucG9wKCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChpID0gMDsgaSA8IGRpbWVuc2lvbnMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgaWYgKGkgPT09IG5vZGUuZGltZW5zaW9uKSB7XG4gICAgICAgICAgbGluZWFyUG9pbnRbZGltZW5zaW9uc1tpXV0gPSBwb2ludFtkaW1lbnNpb25zW2ldXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBsaW5lYXJQb2ludFtkaW1lbnNpb25zW2ldXSA9IG5vZGUub2JqW2RpbWVuc2lvbnNbaV1dO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGxpbmVhckRpc3RhbmNlID0gbWV0cmljKGxpbmVhclBvaW50LCBub2RlLm9iaik7XG5cbiAgICAgIGlmIChub2RlLnJpZ2h0ID09PSBudWxsICYmIG5vZGUubGVmdCA9PT0gbnVsbCkge1xuICAgICAgICBpZiAoYmVzdE5vZGVzLnNpemUoKSA8IG1heE5vZGVzIHx8IG93bkRpc3RhbmNlIDwgYmVzdE5vZGVzLnBlZWsoKVsxXSkge1xuICAgICAgICAgIHNhdmVOb2RlKG5vZGUsIG93bkRpc3RhbmNlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChub2RlLnJpZ2h0ID09PSBudWxsKSB7XG4gICAgICAgIGJlc3RDaGlsZCA9IG5vZGUubGVmdDtcbiAgICAgIH0gZWxzZSBpZiAobm9kZS5sZWZ0ID09PSBudWxsKSB7XG4gICAgICAgIGJlc3RDaGlsZCA9IG5vZGUucmlnaHQ7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAocG9pbnRbZGltZW5zaW9uXSA8IG5vZGUub2JqW2RpbWVuc2lvbl0pIHtcbiAgICAgICAgICBiZXN0Q2hpbGQgPSBub2RlLmxlZnQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYmVzdENoaWxkID0gbm9kZS5yaWdodDtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBuZWFyZXN0U2VhcmNoKGJlc3RDaGlsZCk7XG5cbiAgICAgIGlmIChiZXN0Tm9kZXMuc2l6ZSgpIDwgbWF4Tm9kZXMgfHwgb3duRGlzdGFuY2UgPCBiZXN0Tm9kZXMucGVlaygpWzFdKSB7XG4gICAgICAgIHNhdmVOb2RlKG5vZGUsIG93bkRpc3RhbmNlKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGJlc3ROb2Rlcy5zaXplKCkgPCBtYXhOb2RlcyB8fCBNYXRoLmFicyhsaW5lYXJEaXN0YW5jZSkgPCBiZXN0Tm9kZXMucGVlaygpWzFdKSB7XG4gICAgICAgIGlmIChiZXN0Q2hpbGQgPT09IG5vZGUubGVmdCkge1xuICAgICAgICAgIG90aGVyQ2hpbGQgPSBub2RlLnJpZ2h0O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG90aGVyQ2hpbGQgPSBub2RlLmxlZnQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG90aGVyQ2hpbGQgIT09IG51bGwpIHtcbiAgICAgICAgICBuZWFyZXN0U2VhcmNoKG90aGVyQ2hpbGQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKG1heERpc3RhbmNlKSB7XG4gICAgICBmb3IgKGkgPSAwOyBpIDwgbWF4Tm9kZXM7IGkgKz0gMSkge1xuICAgICAgICBiZXN0Tm9kZXMucHVzaChbbnVsbCwgbWF4RGlzdGFuY2VdKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBuZWFyZXN0U2VhcmNoKHNlbGYucm9vdCk7XG5cbiAgICByZXN1bHQgPSBbXTtcblxuICAgIGZvciAoaSA9IDA7IGkgPCBtYXhOb2RlczsgaSArPSAxKSB7XG4gICAgICBpZiAoYmVzdE5vZGVzLmNvbnRlbnRbaV1bMF0pIHtcbiAgICAgICAgcmVzdWx0LnB1c2goW2Jlc3ROb2Rlcy5jb250ZW50W2ldWzBdLm9iaiwgYmVzdE5vZGVzLmNvbnRlbnRbaV1bMV1dKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICB0aGlzLmJhbGFuY2VGYWN0b3IgPSBmdW5jdGlvbiAoKSB7XG4gICAgZnVuY3Rpb24gaGVpZ2h0KG5vZGUpIHtcbiAgICAgIGlmIChub2RlID09PSBudWxsKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgICAgfVxuICAgICAgcmV0dXJuIE1hdGgubWF4KGhlaWdodChub2RlLmxlZnQpLCBoZWlnaHQobm9kZS5yaWdodCkpICsgMTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjb3VudChub2RlKSB7XG4gICAgICBpZiAobm9kZSA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gMDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBjb3VudChub2RlLmxlZnQpICsgY291bnQobm9kZS5yaWdodCkgKyAxO1xuICAgIH1cblxuICAgIHJldHVybiBoZWlnaHQoc2VsZi5yb290KSAvIChNYXRoLmxvZyhjb3VudChzZWxmLnJvb3QpKSAvIE1hdGgubG9nKDIpKTtcbiAgfTtcbn1cblxuLy8gQmluYXJ5IGhlYXAgaW1wbGVtZW50YXRpb24gZnJvbTpcbi8vIGh0dHA6Ly9lbG9xdWVudGphdmFzY3JpcHQubmV0L2FwcGVuZGl4Mi5odG1sXG5cbmZ1bmN0aW9uIEJpbmFyeUhlYXAoc2NvcmVGdW5jdGlvbil7XG4gIHRoaXMuY29udGVudCA9IFtdO1xuICB0aGlzLnNjb3JlRnVuY3Rpb24gPSBzY29yZUZ1bmN0aW9uO1xufVxuXG5CaW5hcnlIZWFwLnByb3RvdHlwZSA9IHtcbiAgcHVzaDogZnVuY3Rpb24oZWxlbWVudCkge1xuICAgIC8vIEFkZCB0aGUgbmV3IGVsZW1lbnQgdG8gdGhlIGVuZCBvZiB0aGUgYXJyYXkuXG4gICAgdGhpcy5jb250ZW50LnB1c2goZWxlbWVudCk7XG4gICAgLy8gQWxsb3cgaXQgdG8gYnViYmxlIHVwLlxuICAgIHRoaXMuYnViYmxlVXAodGhpcy5jb250ZW50Lmxlbmd0aCAtIDEpO1xuICB9LFxuXG4gIHBvcDogZnVuY3Rpb24oKSB7XG4gICAgLy8gU3RvcmUgdGhlIGZpcnN0IGVsZW1lbnQgc28gd2UgY2FuIHJldHVybiBpdCBsYXRlci5cbiAgICB2YXIgcmVzdWx0ID0gdGhpcy5jb250ZW50WzBdO1xuICAgIC8vIEdldCB0aGUgZWxlbWVudCBhdCB0aGUgZW5kIG9mIHRoZSBhcnJheS5cbiAgICB2YXIgZW5kID0gdGhpcy5jb250ZW50LnBvcCgpO1xuICAgIC8vIElmIHRoZXJlIGFyZSBhbnkgZWxlbWVudHMgbGVmdCwgcHV0IHRoZSBlbmQgZWxlbWVudCBhdCB0aGVcbiAgICAvLyBzdGFydCwgYW5kIGxldCBpdCBzaW5rIGRvd24uXG4gICAgaWYgKHRoaXMuY29udGVudC5sZW5ndGggPiAwKSB7XG4gICAgICB0aGlzLmNvbnRlbnRbMF0gPSBlbmQ7XG4gICAgICB0aGlzLnNpbmtEb3duKDApO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9LFxuXG4gIHBlZWs6IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmNvbnRlbnRbMF07XG4gIH0sXG5cbiAgcmVtb3ZlOiBmdW5jdGlvbihub2RlKSB7XG4gICAgdmFyIGxlbiA9IHRoaXMuY29udGVudC5sZW5ndGg7XG4gICAgLy8gVG8gcmVtb3ZlIGEgdmFsdWUsIHdlIG11c3Qgc2VhcmNoIHRocm91Z2ggdGhlIGFycmF5IHRvIGZpbmRcbiAgICAvLyBpdC5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICBpZiAodGhpcy5jb250ZW50W2ldID09IG5vZGUpIHtcbiAgICAgICAgLy8gV2hlbiBpdCBpcyBmb3VuZCwgdGhlIHByb2Nlc3Mgc2VlbiBpbiAncG9wJyBpcyByZXBlYXRlZFxuICAgICAgICAvLyB0byBmaWxsIHVwIHRoZSBob2xlLlxuICAgICAgICB2YXIgZW5kID0gdGhpcy5jb250ZW50LnBvcCgpO1xuICAgICAgICBpZiAoaSAhPSBsZW4gLSAxKSB7XG4gICAgICAgICAgdGhpcy5jb250ZW50W2ldID0gZW5kO1xuICAgICAgICAgIGlmICh0aGlzLnNjb3JlRnVuY3Rpb24oZW5kKSA8IHRoaXMuc2NvcmVGdW5jdGlvbihub2RlKSlcbiAgICAgICAgICAgIHRoaXMuYnViYmxlVXAoaSk7XG4gICAgICAgICAgZWxzZVxuICAgICAgICAgICAgdGhpcy5zaW5rRG93bihpKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuICAgIHRocm93IG5ldyBFcnJvcihcIk5vZGUgbm90IGZvdW5kLlwiKTtcbiAgfSxcblxuICBzaXplOiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5jb250ZW50Lmxlbmd0aDtcbiAgfSxcblxuICBidWJibGVVcDogZnVuY3Rpb24obikge1xuICAgIC8vIEZldGNoIHRoZSBlbGVtZW50IHRoYXQgaGFzIHRvIGJlIG1vdmVkLlxuICAgIHZhciBlbGVtZW50ID0gdGhpcy5jb250ZW50W25dO1xuICAgIC8vIFdoZW4gYXQgMCwgYW4gZWxlbWVudCBjYW4gbm90IGdvIHVwIGFueSBmdXJ0aGVyLlxuICAgIHdoaWxlIChuID4gMCkge1xuICAgICAgLy8gQ29tcHV0ZSB0aGUgcGFyZW50IGVsZW1lbnQncyBpbmRleCwgYW5kIGZldGNoIGl0LlxuICAgICAgdmFyIHBhcmVudE4gPSBNYXRoLmZsb29yKChuICsgMSkgLyAyKSAtIDEsXG4gICAgICAgICAgcGFyZW50ID0gdGhpcy5jb250ZW50W3BhcmVudE5dO1xuICAgICAgLy8gU3dhcCB0aGUgZWxlbWVudHMgaWYgdGhlIHBhcmVudCBpcyBncmVhdGVyLlxuICAgICAgaWYgKHRoaXMuc2NvcmVGdW5jdGlvbihlbGVtZW50KSA8IHRoaXMuc2NvcmVGdW5jdGlvbihwYXJlbnQpKSB7XG4gICAgICAgIHRoaXMuY29udGVudFtwYXJlbnROXSA9IGVsZW1lbnQ7XG4gICAgICAgIHRoaXMuY29udGVudFtuXSA9IHBhcmVudDtcbiAgICAgICAgLy8gVXBkYXRlICduJyB0byBjb250aW51ZSBhdCB0aGUgbmV3IHBvc2l0aW9uLlxuICAgICAgICBuID0gcGFyZW50TjtcbiAgICAgIH1cbiAgICAgIC8vIEZvdW5kIGEgcGFyZW50IHRoYXQgaXMgbGVzcywgbm8gbmVlZCB0byBtb3ZlIGl0IGZ1cnRoZXIuXG4gICAgICBlbHNlIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG4gIHNpbmtEb3duOiBmdW5jdGlvbihuKSB7XG4gICAgLy8gTG9vayB1cCB0aGUgdGFyZ2V0IGVsZW1lbnQgYW5kIGl0cyBzY29yZS5cbiAgICB2YXIgbGVuZ3RoID0gdGhpcy5jb250ZW50Lmxlbmd0aCxcbiAgICAgICAgZWxlbWVudCA9IHRoaXMuY29udGVudFtuXSxcbiAgICAgICAgZWxlbVNjb3JlID0gdGhpcy5zY29yZUZ1bmN0aW9uKGVsZW1lbnQpO1xuXG4gICAgd2hpbGUodHJ1ZSkge1xuICAgICAgLy8gQ29tcHV0ZSB0aGUgaW5kaWNlcyBvZiB0aGUgY2hpbGQgZWxlbWVudHMuXG4gICAgICB2YXIgY2hpbGQyTiA9IChuICsgMSkgKiAyLCBjaGlsZDFOID0gY2hpbGQyTiAtIDE7XG4gICAgICAvLyBUaGlzIGlzIHVzZWQgdG8gc3RvcmUgdGhlIG5ldyBwb3NpdGlvbiBvZiB0aGUgZWxlbWVudCxcbiAgICAgIC8vIGlmIGFueS5cbiAgICAgIHZhciBzd2FwID0gbnVsbDtcbiAgICAgIC8vIElmIHRoZSBmaXJzdCBjaGlsZCBleGlzdHMgKGlzIGluc2lkZSB0aGUgYXJyYXkpLi4uXG4gICAgICBpZiAoY2hpbGQxTiA8IGxlbmd0aCkge1xuICAgICAgICAvLyBMb29rIGl0IHVwIGFuZCBjb21wdXRlIGl0cyBzY29yZS5cbiAgICAgICAgdmFyIGNoaWxkMSA9IHRoaXMuY29udGVudFtjaGlsZDFOXSxcbiAgICAgICAgICAgIGNoaWxkMVNjb3JlID0gdGhpcy5zY29yZUZ1bmN0aW9uKGNoaWxkMSk7XG4gICAgICAgIC8vIElmIHRoZSBzY29yZSBpcyBsZXNzIHRoYW4gb3VyIGVsZW1lbnQncywgd2UgbmVlZCB0byBzd2FwLlxuICAgICAgICBpZiAoY2hpbGQxU2NvcmUgPCBlbGVtU2NvcmUpXG4gICAgICAgICAgc3dhcCA9IGNoaWxkMU47XG4gICAgICB9XG4gICAgICAvLyBEbyB0aGUgc2FtZSBjaGVja3MgZm9yIHRoZSBvdGhlciBjaGlsZC5cbiAgICAgIGlmIChjaGlsZDJOIDwgbGVuZ3RoKSB7XG4gICAgICAgIHZhciBjaGlsZDIgPSB0aGlzLmNvbnRlbnRbY2hpbGQyTl0sXG4gICAgICAgICAgICBjaGlsZDJTY29yZSA9IHRoaXMuc2NvcmVGdW5jdGlvbihjaGlsZDIpO1xuICAgICAgICBpZiAoY2hpbGQyU2NvcmUgPCAoc3dhcCA9PSBudWxsID8gZWxlbVNjb3JlIDogY2hpbGQxU2NvcmUpKXtcbiAgICAgICAgICBzd2FwID0gY2hpbGQyTjtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBJZiB0aGUgZWxlbWVudCBuZWVkcyB0byBiZSBtb3ZlZCwgc3dhcCBpdCwgYW5kIGNvbnRpbnVlLlxuICAgICAgaWYgKHN3YXAgIT0gbnVsbCkge1xuICAgICAgICB0aGlzLmNvbnRlbnRbbl0gPSB0aGlzLmNvbnRlbnRbc3dhcF07XG4gICAgICAgIHRoaXMuY29udGVudFtzd2FwXSA9IGVsZW1lbnQ7XG4gICAgICAgIG4gPSBzd2FwO1xuICAgICAgfVxuICAgICAgLy8gT3RoZXJ3aXNlLCB3ZSBhcmUgZG9uZS5cbiAgICAgIGVsc2Uge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBjcmVhdGVLZFRyZWU6IGZ1bmN0aW9uIChwb2ludHMsIG1ldHJpYywgZGltZW5zaW9ucykge1xuICAgIHJldHVybiBuZXcgS2RUcmVlKHBvaW50cywgbWV0cmljLCBkaW1lbnNpb25zKVxuICB9XG59XG4iXX0=
(1)
});
