!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.BinauralFIR=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
"use strict";
var kdt = require('kdt');
var BiquadFilter = require("biquad-filter");
var FractionalDelay = require("fractional-delay");
var audioContext = require("audio-context");
var BinauralModeled = function BinauralModeled() {
  this.context = undefined;
  this.hrtfDataset = undefined;
  this.hrtfDatasetLength = undefined;
  this.nextPosition = [];
  this.changeWhenFinishCrossfading = false;
  this.intervalID = undefined;
  this.position = [];
  this.crossfadeDuration = 20 / 1000;
  this.bufferSize = 1024;
  this.sampleRate = undefined;
  this.input = undefined;
  this.tree = -1;
  this.mainAudioGraph = undefined;
  this.secondaryAudioGraph = undefined;
  this.input = audioContext.createGain();
  this.mainAudioGraph = new ProcessingAudioGraph();
  this.mainAudioGraph.gain.value = 1;
  this.input.connect(this.mainAudioGraph.input);
  this.secondaryAudioGraph = new ProcessingAudioGraph();
  this.secondaryAudioGraph.gain.value = 0;
  this.input.connect(this.secondaryAudioGraph.input);
  this.sampleRate = audioContext.sampleRate;
  this.input.connect(this.mainAudioGraph.input);
  this.input.connect(this.secondaryAudioGraph.input);
  return this;
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
    var now = audioContext.currentTime;
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
var ProcessingAudioGraph = function ProcessingAudioGraph() {
  this.biquadFilterLeft = undefined;
  this.biquadFilterRight = undefined;
  this.fractionalDelayLeft = undefined;
  this.fractionalDelayRight = undefined;
  this.gainNode = undefined;
  this.input = undefined;
  this.processorNode = undefined;
  this.bufferSize = 1024;
  this.input = audioContext.createGain();
  this.gainNode = audioContext.createGain();
  this.biquadFilterLeft = new BiquadFilter();
  this.biquadFilterRight = new BiquadFilter();
  this.fractionalDelayLeft = new FractionalDelay(44100);
  this.fractionalDelayRight = new FractionalDelay(44100);
  this.processorNode = audioContext.createScriptProcessor(this.bufferSize);
  this.input.connect(this.processorNode);
  this.processorNode.connect(this.gainNode);
  this.processorNodeFunction();
  return this;
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
},{"audio-context":3,"biquad-filter":4,"fractional-delay":5,"kdt":6}],2:[function(require,module,exports){
/* Copyright 2013 Chris Wilson

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

/* 

This monkeypatch library is intended to be included in projects that are
written to the proper AudioContext spec (instead of webkitAudioContext), 
and that use the new naming and proper bits of the Web Audio API (e.g. 
using BufferSourceNode.start() instead of BufferSourceNode.noteOn()), but may
have to run on systems that only support the deprecated bits.

This library should be harmless to include if the browser supports 
unprefixed "AudioContext", and/or if it supports the new names.  

The patches this library handles:
if window.AudioContext is unsupported, it will be aliased to webkitAudioContext().
if AudioBufferSourceNode.start() is unimplemented, it will be routed to noteOn() or
noteGrainOn(), depending on parameters.

The following aliases only take effect if the new names are not already in place:

AudioBufferSourceNode.stop() is aliased to noteOff()
AudioContext.createGain() is aliased to createGainNode()
AudioContext.createDelay() is aliased to createDelayNode()
AudioContext.createScriptProcessor() is aliased to createJavaScriptNode()
AudioContext.createPeriodicWave() is aliased to createWaveTable()
OscillatorNode.start() is aliased to noteOn()
OscillatorNode.stop() is aliased to noteOff()
OscillatorNode.setPeriodicWave() is aliased to setWaveTable()
AudioParam.setTargetAtTime() is aliased to setTargetValueAtTime()

This library does NOT patch the enumerated type changes, as it is 
recommended in the specification that implementations support both integer
and string types for AudioPannerNode.panningModel, AudioPannerNode.distanceModel 
BiquadFilterNode.type and OscillatorNode.type.

*/
(function (global, exports, perf) {
  'use strict';

  function fixSetTarget(param) {
    if (!param) // if NYI, just return
      return;
    if (!param.setTargetAtTime)
      param.setTargetAtTime = param.setTargetValueAtTime; 
  }

  if (window.hasOwnProperty('webkitAudioContext') && 
      !window.hasOwnProperty('AudioContext')) {
    window.AudioContext = webkitAudioContext;

    if (!AudioContext.prototype.hasOwnProperty('createGain'))
      AudioContext.prototype.createGain = AudioContext.prototype.createGainNode;
    if (!AudioContext.prototype.hasOwnProperty('createDelay'))
      AudioContext.prototype.createDelay = AudioContext.prototype.createDelayNode;
    if (!AudioContext.prototype.hasOwnProperty('createScriptProcessor'))
      AudioContext.prototype.createScriptProcessor = AudioContext.prototype.createJavaScriptNode;
    if (!AudioContext.prototype.hasOwnProperty('createPeriodicWave'))
      AudioContext.prototype.createPeriodicWave = AudioContext.prototype.createWaveTable;


    AudioContext.prototype.internal_createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function() { 
      var node = this.internal_createGain();
      fixSetTarget(node.gain);
      return node;
    };

    AudioContext.prototype.internal_createDelay = AudioContext.prototype.createDelay;
    AudioContext.prototype.createDelay = function(maxDelayTime) { 
      var node = maxDelayTime ? this.internal_createDelay(maxDelayTime) : this.internal_createDelay();
      fixSetTarget(node.delayTime);
      return node;
    };

    AudioContext.prototype.internal_createBufferSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function() { 
      var node = this.internal_createBufferSource();
      if (!node.start) {
        node.start = function ( when, offset, duration ) {
          if ( offset || duration )
            this.noteGrainOn( when, offset, duration );
          else
            this.noteOn( when );
        };
      }
      if (!node.stop)
        node.stop = node.noteOff;
      fixSetTarget(node.playbackRate);
      return node;
    };

    AudioContext.prototype.internal_createDynamicsCompressor = AudioContext.prototype.createDynamicsCompressor;
    AudioContext.prototype.createDynamicsCompressor = function() { 
      var node = this.internal_createDynamicsCompressor();
      fixSetTarget(node.threshold);
      fixSetTarget(node.knee);
      fixSetTarget(node.ratio);
      fixSetTarget(node.reduction);
      fixSetTarget(node.attack);
      fixSetTarget(node.release);
      return node;
    };

    AudioContext.prototype.internal_createBiquadFilter = AudioContext.prototype.createBiquadFilter;
    AudioContext.prototype.createBiquadFilter = function() { 
      var node = this.internal_createBiquadFilter();
      fixSetTarget(node.frequency);
      fixSetTarget(node.detune);
      fixSetTarget(node.Q);
      fixSetTarget(node.gain);
      return node;
    };

    if (AudioContext.prototype.hasOwnProperty( 'createOscillator' )) {
      AudioContext.prototype.internal_createOscillator = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function() { 
        var node = this.internal_createOscillator();
        if (!node.start)
          node.start = node.noteOn; 
        if (!node.stop)
          node.stop = node.noteOff;
        if (!node.setPeriodicWave)
          node.setPeriodicWave = node.setWaveTable;
        fixSetTarget(node.frequency);
        fixSetTarget(node.detune);
        return node;
      };
    }
  }
}(window));
},{}],3:[function(require,module,exports){
/*globals AudioContext*/
require('./ac-monkeypatch');
window.waves = window.waves || {};
module.exports = window.waves.audioContext = window.waves.audioContext || new AudioContext();
},{"./ac-monkeypatch":2}],4:[function(require,module,exports){
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

},{}],5:[function(require,module,exports){
(function (global){
!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.FractionalDelay=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],6:[function(require,module,exports){
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

},{}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsIi9Vc2Vycy9nb2xkc3ptaWR0L3NhbS9wcm8vZGV2L2JpbmF1cmFsTW9kZWxlZC9iaW5hdXJhbC1tb2RlbGVkLmVzNi5qcyIsIm5vZGVfbW9kdWxlcy9hdWRpby1jb250ZXh0L2FjLW1vbmtleXBhdGNoLmpzIiwibm9kZV9tb2R1bGVzL2F1ZGlvLWNvbnRleHQvYXVkaW8tY29udGV4dC5qcyIsIm5vZGVfbW9kdWxlcy9rZHQvaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNNQTtBQUFBLEFBQUksRUFBQSxDQUFBLEdBQUUsRUFBSSxDQUFBLE9BQU0sQUFBQyxDQUFDLEtBQUksQ0FBQyxDQUFDO0FBQ3hCLEFBQUksRUFBQSxDQUFBLFlBQVcsRUFBSSxDQUFBLE9BQU0sQUFBQyxDQUFDLGVBQWMsQ0FBQyxDQUFDO0FBQzNDLEFBQUksRUFBQSxDQUFBLGVBQWMsRUFBSSxDQUFBLE9BQU0sQUFBQyxDQUFDLGtCQUFpQixDQUFDLENBQUM7QUFDakQsQUFBSSxFQUFBLENBQUEsWUFBVyxFQUFJLENBQUEsT0FBTSxBQUFDLENBQUMsZUFBYyxDQUFDLENBQUM7QUFUM0MsQUFBSSxFQUFBLGtCQWNKLFNBQU0sZ0JBQWMsQ0FPTCxBQUFDLENBQUU7QUFHVixLQUFHLFFBQVEsRUFBSSxVQUFRLENBQUM7QUFDeEIsS0FBRyxZQUFZLEVBQUksVUFBUSxDQUFDO0FBQzVCLEtBQUcsa0JBQWtCLEVBQUksVUFBUSxDQUFDO0FBQ2xDLEtBQUcsYUFBYSxFQUFJLEdBQUMsQ0FBQztBQUN0QixLQUFHLDRCQUE0QixFQUFJLE1BQUksQ0FBQztBQUN4QyxLQUFHLFdBQVcsRUFBSSxVQUFRLENBQUM7QUFDM0IsS0FBRyxTQUFTLEVBQUksR0FBQyxDQUFBO0FBQ2pCLEtBQUcsa0JBQWtCLEVB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Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLyoqXG4gKiBAZmlsZU92ZXJ2aWV3XG4gKlxuICogQGF1dGhvciBBcm5hdSBKdWxpw6AgPEFybmF1Lkp1bGlhQGdtYWlsLmNvbT5cbiAqIEB2ZXJzaW9uIDAuMS4wXG4gKi9cbnZhciBrZHQgPSByZXF1aXJlKCdrZHQnKTtcbnZhciBCaXF1YWRGaWx0ZXIgPSByZXF1aXJlKFwiYmlxdWFkLWZpbHRlclwiKTtcbnZhciBGcmFjdGlvbmFsRGVsYXkgPSByZXF1aXJlKFwiZnJhY3Rpb25hbC1kZWxheVwiKTtcbnZhciBhdWRpb0NvbnRleHQgPSByZXF1aXJlKFwiYXVkaW8tY29udGV4dFwiKTtcblxuLyoqXG4gKiBCaW5hdXJhbE1vZGVsZWQgb2JqZWN0IGFzIGFuIEVDTUFTY3JpcHQ1IHByb3BlcnRpZXMgb2JqZWN0LlxuICovXG5jbGFzcyBCaW5hdXJhbE1vZGVsZWQge1xuXG4gICAgLyoqXG4gICAgICogTWFuZGF0b3J5IGluaXRpYWxpemF0aW9uIG1ldGhvZC5cbiAgICAgKiBAcHVibGljXG4gICAgICogQGNoYWluYWJsZVxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKCkge1xuXG4gICAgICAgIC8vIFByaXZhdGUgcHJvcGVydGllc1xuICAgICAgICB0aGlzLmNvbnRleHQgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuaHJ0ZkRhdGFzZXQgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuaHJ0ZkRhdGFzZXRMZW5ndGggPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMubmV4dFBvc2l0aW9uID0gW107XG4gICAgICAgIHRoaXMuY2hhbmdlV2hlbkZpbmlzaENyb3NzZmFkaW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMuaW50ZXJ2YWxJRCA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5wb3NpdGlvbiA9IFtdXG4gICAgICAgIHRoaXMuY3Jvc3NmYWRlRHVyYXRpb24gPSAyMCAvIDEwMDBcbiAgICAgICAgdGhpcy5idWZmZXJTaXplID0gMTAyNDtcbiAgICAgICAgdGhpcy5zYW1wbGVSYXRlID0gdW5kZWZpbmVkO1xuICAgICAgICB0aGlzLmlucHV0ID0gdW5kZWZpbmVkO1xuICAgICAgICB0aGlzLnRyZWUgPSAtMTtcbiAgICAgICAgdGhpcy5tYWluQXVkaW9HcmFwaCA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoID0gdW5kZWZpbmVkO1xuXG4gICAgICAgIHRoaXMuaW5wdXQgPSBhdWRpb0NvbnRleHQuY3JlYXRlR2FpbigpO1xuXG4gICAgICAgIC8vIFR3byBzdWIgYXVkaW8gZ3JhcGhzIGNyZWF0aW9uOlxuICAgICAgICAvLyAtIG1haW5Db252b2x2ZXIgd2hpY2ggcmVwcmVzZW50cyB0aGUgY3VycmVudCBzdGF0ZVxuICAgICAgICAvLyAtIGFuZCBzZWNvbmRhcnlDb252b2x2ZXIgd2hpY2ggcmVwcmVzZW50cyB0aGUgcG90ZW50aWFsIHRhcmdldCBzdGF0ZVxuICAgICAgICAvLyAgIHdoZW4gbW92aW5nIHNvdW5kIHRvIGEgbmV3IHBvc2l0aW9uXG5cbiAgICAgICAgdGhpcy5tYWluQXVkaW9HcmFwaCA9IG5ldyBQcm9jZXNzaW5nQXVkaW9HcmFwaCgpO1xuICAgICAgICB0aGlzLm1haW5BdWRpb0dyYXBoLmdhaW4udmFsdWUgPSAxO1xuICAgICAgICB0aGlzLmlucHV0LmNvbm5lY3QodGhpcy5tYWluQXVkaW9HcmFwaC5pbnB1dCk7XG5cbiAgICAgICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoID0gbmV3IFByb2Nlc3NpbmdBdWRpb0dyYXBoKCk7XG4gICAgICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5nYWluLnZhbHVlID0gMDtcbiAgICAgICAgdGhpcy5pbnB1dC5jb25uZWN0KHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5pbnB1dCk7XG4gICAgICAgIC8vIFdlYiBBdWRpb1xuICAgICAgICB0aGlzLnNhbXBsZVJhdGUgPSBhdWRpb0NvbnRleHQuc2FtcGxlUmF0ZTtcbiAgICAgICAgLy9Db25uZWN0aW9uc1xuICAgICAgICB0aGlzLmlucHV0LmNvbm5lY3QodGhpcy5tYWluQXVkaW9HcmFwaC5pbnB1dCk7XG4gICAgICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguaW5wdXQpO1xuXG4gICAgICAgIHJldHVybiB0aGlzOyAvLyBGb3IgY2hhaW5hYmlsaXR5XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBDb25uZWN0cyB0aGUgYmluYXVyYWxNb2RlbGVkTm9kZSB0byB0aGUgV2ViIEF1ZGlvIGdyYXBoXG4gICAgICogQHB1YmxpY1xuICAgICAqIEBjaGFpbmFibGVcbiAgICAgKiBAcGFyYW0gbm9kZSBEZXN0aW5hdGlvbiBub2RlXG4gICAgICovXG4gICAgY29ubmVjdChub2RlKSB7XG4gICAgICAgIHRoaXMubWFpbkF1ZGlvR3JhcGguY29ubmVjdChub2RlKTtcbiAgICAgICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLmNvbm5lY3Qobm9kZSk7XG4gICAgICAgIHJldHVybiB0aGlzOyAvLyBGb3IgY2hhaW5hYmlsaXR5XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBEaXNjb25uZWN0IHRoZSBiaW5hdXJhbE1vZGVsZWROb2RlIGZyb20gdGhlIFdlYiBBdWRpbyBncmFwaFxuICAgICAqIEBwdWJsaWNcbiAgICAgKiBAY2hhaW5hYmxlXG4gICAgICogQHBhcmFtIG5vZGUgRGVzdGluYXRpb24gbm9kZVxuICAgICAqL1xuICAgIGRpc2Nvbm5lY3Qobm9kZSkge1xuICAgICAgICB0aGlzLm1haW5BdWRpb0dyYXBoLmRpc2Nvbm5lY3Qobm9kZSk7XG4gICAgICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5kaXNjb25uZWN0KG5vZGUpO1xuICAgICAgICByZXR1cm4gdGhpczsgLy8gRm9yIGNoYWluYWJpbGl0eVxuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogU2V0IEhSVEYgRGF0YXNldCB0byBiZSB1c2VkIHdpdGggdGhlIHZpcnR1YWwgc291cmNlLlxuICAgICAqIEBwdWJsaWNcbiAgICAgKiBAY2hhaW5hYmxlXG4gICAgICogQHBhcmFtIGhydGZEYXRhc2V0IEFycmF5IG9mIE9iamVjdHMgY29udGFpbmluZyB0aGUgYXppbXV0aCwgZGlzdGFuY2UsIGVsZXZhdGlvbiwgdXJsIGFuZCBidWZmZXIgZm9yIGVhY2ggcG9pbnRcbiAgICAgKi9cbiAgICBzZXQgSFJURkRhdGFzZXQoaHJ0ZkRhdGFzZXQpIHtcbiAgICAgICAgdGhpcy5ocnRmRGF0YXNldCA9IGhydGZEYXRhc2V0O1xuICAgICAgICB0aGlzLmhydGZEYXRhc2V0TGVuZ3RoID0gdGhpcy5ocnRmRGF0YXNldC5sZW5ndGg7XG5cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLmhydGZEYXRhc2V0TGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBocnRmID0gdGhpcy5ocnRmRGF0YXNldFtpXTtcbiAgICAgICAgICAgIC8vIEF6aW11dGggYW5kIGVsZXZhdGlvbiB0byByYWRpYW5zXG4gICAgICAgICAgICB2YXIgYXppbXV0aFJhZGlhbnMgPSBocnRmLmF6aW11dGggKiBNYXRoLlBJIC8gMTgwO1xuICAgICAgICAgICAgdmFyIGVsZXZhdGlvblJhZGlhbnMgPSBocnRmLmVsZXZhdGlvbiAqIE1hdGguUEkgLyAxODA7XG4gICAgICAgICAgICB2YXIgY2F0ZXNpYW5Db29yZCA9IHRoaXMuc3BoZXJpY2FsVG9DYXJ0ZXNpYW4oYXppbXV0aFJhZGlhbnMsIGVsZXZhdGlvblJhZGlhbnMsIGhydGYuZGlzdGFuY2UpO1xuICAgICAgICAgICAgaHJ0Zi54ID0gY2F0ZXNpYW5Db29yZC54O1xuICAgICAgICAgICAgaHJ0Zi55ID0gY2F0ZXNpYW5Db29yZC55O1xuICAgICAgICAgICAgaHJ0Zi56ID0gY2F0ZXNpYW5Db29yZC56O1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudHJlZSA9IGtkdC5jcmVhdGVLZFRyZWUodGhpcy5ocnRmRGF0YXNldCwgdGhpcy5kaXN0YW5jZSwgWyd4JywgJ3knLCAneiddKTtcblxuICAgICAgICAvLyBQdXQgZGVmYXVsdCB2YWx1ZXNcbiAgICAgICAgdmFyIGhydGZOZXh0UG9zaXRpb24gPSB0aGlzLmdldEhSVEYoMCwgMCwgMSk7XG4gICAgICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5zZXRDb2VmZmljaWVudHMoaHJ0Zk5leHRQb3NpdGlvbi5paXJfY29lZmZzX2xlZnQsIGhydGZOZXh0UG9zaXRpb24uaWlyX2NvZWZmc19yaWdodCk7XG4gICAgICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5zZXREZWxheShocnRmTmV4dFBvc2l0aW9uLml0ZCAvIDEwMDApO1xuICAgICAgICB0aGlzLm1haW5BdWRpb0dyYXBoLnNldENvZWZmaWNpZW50cyhocnRmTmV4dFBvc2l0aW9uLmlpcl9jb2VmZnNfbGVmdCwgaHJ0Zk5leHRQb3NpdGlvbi5paXJfY29lZmZzX3JpZ2h0KTtcbiAgICAgICAgdGhpcy5tYWluQXVkaW9HcmFwaC5zZXREZWxheShocnRmTmV4dFBvc2l0aW9uLml0ZCAvIDEwMDApO1xuICAgIH1cbiAgICBnZXQgSFJURkRhdGFzZXQoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmhydGZEYXRhc2V0O1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogQ2FsY3VsYXRlIHRoZSBkaXN0YW5jZSBiZXR3ZWVuIHR3byBwb2ludHMgaW4gYSAzLUQgc3BhY2UuXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAY2hhaW5hYmxlXG4gICAgICogQHBhcmFtIGEgT2JqZWN0IGNvbnRhaW5pbmcgdGhyZWUgcHJvcGVydGllczogeCwgeSwgelxuICAgICAqIEBwYXJhbSBiIE9iamVjdCBjb250YWluaW5nIHRocmVlIHByb3BlcnRpZXM6IHgsIHksIHpcbiAgICAgKi9cbiAgICBkaXN0YW5jZShhLCBiKSB7XG4gICAgICAgIC8vIE5vIG5lZWQgdG8gY29tcHV0ZSBzcXVhcmUgcm9vdCBoZXJlIGZvciBkaXN0YW5jZSBjb21wYXJpc29uLCB0aGlzIGlzIG1vcmUgZWZpY2llbnQuXG4gICAgICAgIHJldHVybiBNYXRoLnBvdyhhLnggLSBiLngsIDIpICsgTWF0aC5wb3coYS55IC0gYi55LCAyKSArIE1hdGgucG93KGEueiAtIGIueiwgMik7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2V0IGdhaW4gdmFsdWUgYW5kIHNxdWFyZWQgdm9sdW1lLlxuICAgICAqIEBwcml2YXRlXG4gICAgICogQGNoYWluYWJsZVxuICAgICAqIEB0b2RvIDogcmVhbG1lbnQgdmEgYXF1w60gYWl4w7I/XG4gICAgICovXG4gICAgc2V0TGFzdFBvc2l0aW9uKCkge1xuICAgICAgICBpZiAoIXRoaXMuaXNDcm9zc2ZhZGluZygpKSB7XG4gICAgICAgICAgICB0aGlzLmNoYW5nZVdoZW5GaW5pc2hDcm9zc2ZhZGluZyA9IGZhbHNlO1xuICAgICAgICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLmludGVydmFsSUQpO1xuICAgICAgICAgICAgdGhpcy5yZWFsbHlTdGFydFBvc2l0aW9uKCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcm9zc2ZhZGluZ1xuICAgICAqIEBwcml2YXRlXG4gICAgICogQGNoYWluYWJsZVxuICAgICAqL1xuICAgIGNyb3NzZmFkaW5nKCkge1xuICAgICAgICAvLyBEbyB0aGUgY3Jvc3NmYWRpbmcgYmV0d2VlbiBtYWluQXVkaW9HcmFwaCBhbmQgc2Vjb25kYXJ5QXVkaW9HcmFwaFxuICAgICAgICB2YXIgbm93ID0gYXVkaW9Db250ZXh0LmN1cnJlbnRUaW1lO1xuICAgICAgICAvLyBXYWl0IHR3byBidWZmZXJzIHVudGlsIGRvIHRoZSBjaGFuZ2UgKHNjcmlwdFByb2Nlc3Nvck5vZGUgb25seSB1cGRhdGUgdGhlIHZhcmlhYmxlcyBhdCB0aGUgZmlyc3Qgc2FtcGxlIG9mIHRoZSBidWZmZXIpXG4gICAgICAgIHRoaXMubWFpbkF1ZGlvR3JhcGguZ2Fpbi5zZXRWYWx1ZUF0VGltZSgxLCBub3cgKyAyICogdGhpcy5idWZmZXJTaXplIC8gdGhpcy5zYW1wbGVSYXRlKTtcbiAgICAgICAgdGhpcy5tYWluQXVkaW9HcmFwaC5nYWluLmxpbmVhclJhbXBUb1ZhbHVlQXRUaW1lKDAsIG5vdyArIHRoaXMuY3Jvc3NmYWRlRHVyYXRpb24gKyAyICogdGhpcy5idWZmZXJTaXplIC8gdGhpcy5zYW1wbGVSYXRlKTtcblxuICAgICAgICB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguZ2Fpbi5zZXRWYWx1ZUF0VGltZSgwLCBub3cgKyAyICogdGhpcy5idWZmZXJTaXplIC8gdGhpcy5zYW1wbGVSYXRlKTtcbiAgICAgICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLmdhaW4ubGluZWFyUmFtcFRvVmFsdWVBdFRpbWUoMSwgbm93ICsgdGhpcy5jcm9zc2ZhZGVEdXJhdGlvbiArIDIgKiB0aGlzLmJ1ZmZlclNpemUgLyB0aGlzLnNhbXBsZVJhdGUpO1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogU2V0IHBvc2l0aW9uIG9mIHRoZSB2aXJ0dWFsIHNvdXJjZVxuICAgICAqIEBwdWJsaWNcbiAgICAgKiBAY2hhaW5hYmxlXG4gICAgICogQHBhcmFtIGF6aW11dGggQXppbXV0aCBpbiBkZWdyZWVzICjCsCk6IGZyb20gMCB0byAtMTgwIGZvciBzb3VyY2Ugb24geW91ciBsZWZ0LCBhbmQgZnJvbSAwIHRvIDE4MCBmb3Igc291cmNlIG9uIHlvdXIgcmlnaHRcbiAgICAgKiBAcGFyYW0gZWxldmF0aW9uIEVsZXZhdGlvbiBpbiBkZWdyZWVzICjCsCk6IGZyb20gMCB0byA5MCBmb3Igc291cmNlIGFib3ZlIHlvdXIgaGVhZCwgMCBmb3Igc291cmNlIGluIGZyb250IG9mIHlvdXIgaGVhZCwgYW5kIGZyb20gMCB0byAtOTAgZm9yIHNvdXJjZSBiZWxvdyB5b3VyIGhlYWQpXG4gICAgICogQHBhcmFtIGRpc3RhbmNlIERpc3RhbmNlIGluIG1ldGVyc1xuICAgICAqL1xuICAgIHNldFBvc2l0aW9uKGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpIHtcblxuICAgICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMykge1xuICAgICAgICAgICAgLy8gQ2FsY3VsYXRlIHRoZSBuZWFyZXN0IHBvc2l0aW9uIGZvciB0aGUgaW5wdXQgYXppbXV0aCwgZWxldmF0aW9uIGFuZCBkaXN0YW5jZVxuICAgICAgICAgICAgdmFyIG5lYXJlc3RQb3NpdGlvbiA9IHRoaXMuZ2V0UmVhbENvb3JkaW5hdGVzKGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpO1xuICAgICAgICAgICAgLy8gTm8gbmVlZCB0byBjaGFuZ2UgdGhlIGN1cnJlbnQgSFJURiBsb2FkZWQgaWYgc2V0dGVkIHBvc2l0aW9uIGVxdWFsIGN1cnJlbnQgcG9zaXRpb25cbiAgICAgICAgICAgIGlmIChuZWFyZXN0UG9zaXRpb24uYXppbXV0aCAhPT0gdGhpcy5wb3NpdGlvbi5hemltdXRoIHx8IG5lYXJlc3RQb3NpdGlvbi5lbGV2YXRpb24gIT09IHRoaXMucG9zaXRpb24uZWxldmF0aW9uIHx8IG5lYXJlc3RQb3NpdGlvbi5kaXN0YW5jZSAhPT0gdGhpcy5wb3NpdGlvbi5kaXN0YW5jZSkge1xuICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZSBjcm9zc2ZhZGluZyBpcyBhY3RpdmVcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5pc0Nyb3NzZmFkaW5nKCkgPT09IHRydWUpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhlcmUgaXMgYSB2YWx1ZSB3YWl0aW5nIHRvIGJlIHNldFxuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5jaGFuZ2VXaGVuRmluaXNoQ3Jvc3NmYWRpbmcgPT09IHRydWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFN0b3AgdGhlIHBhc3Qgc2V0SW50ZXJ2YWwgZXZlbnQuXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGVhckludGVydmFsKHRoaXMuaW50ZXJ2YWxJRCk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNoYW5nZVdoZW5GaW5pc2hDcm9zc2ZhZGluZyA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAvLyBTYXZlIHRoZSBwb3NpdGlvblxuICAgICAgICAgICAgICAgICAgICB0aGlzLm5leHRQb3NpdGlvbi5hemltdXRoID0gbmVhcmVzdFBvc2l0aW9uLmF6aW11dGg7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubmV4dFBvc2l0aW9uLmVsZXZhdGlvbiA9IG5lYXJlc3RQb3NpdGlvbi5lbGV2YXRpb247XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubmV4dFBvc2l0aW9uLmRpc3RhbmNlID0gbmVhcmVzdFBvc2l0aW9uLmRpc3RhbmNlO1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIFN0YXJ0IHRoZSBzZXRJbnRlcnZhbDogd2FpdCB1bnRpbCB0aGUgY3Jvc3NmYWRpbmcgaXMgZmluaXNoZWQuXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuaW50ZXJ2YWxJRCA9IHdpbmRvdy5zZXRJbnRlcnZhbCh0aGlzLnNldExhc3RQb3NpdGlvbi5iaW5kKHRoaXMpLCAwLjAwNSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5uZXh0UG9zaXRpb24uYXppbXV0aCA9IG5lYXJlc3RQb3NpdGlvbi5hemltdXRoO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm5leHRQb3NpdGlvbi5lbGV2YXRpb24gPSBuZWFyZXN0UG9zaXRpb24uZWxldmF0aW9uO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm5leHRQb3NpdGlvbi5kaXN0YW5jZSA9IG5lYXJlc3RQb3NpdGlvbi5kaXN0YW5jZTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZWFsbHlTdGFydFBvc2l0aW9uKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzOyAvLyBGb3IgY2hhaW5hYmlsaXR5XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIFJlYWxseSBjaGFuZ2UgdGhlIHBvc2l0aW9uXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICByZWFsbHlTdGFydFBvc2l0aW9uKCkge1xuICAgICAgICAvLyBTYXZlIHRoZSBjdXJyZW50IHBvc2l0aW9uXG4gICAgICAgIHRoaXMucG9zaXRpb24uYXppbXV0aCA9IHRoaXMubmV4dFBvc2l0aW9uLmF6aW11dGg7XG4gICAgICAgIHRoaXMucG9zaXRpb24uZWxldmF0aW9uID0gdGhpcy5uZXh0UG9zaXRpb24uZWxldmF0aW9uO1xuICAgICAgICB0aGlzLnBvc2l0aW9uLmRpc3RhbmNlID0gdGhpcy5uZXh0UG9zaXRpb24uZGlzdGFuY2U7XG5cbiAgICAgICAgdmFyIGhydGZOZXh0UG9zaXRpb24gPSB0aGlzLmdldEhSVEYodGhpcy5wb3NpdGlvbi5hemltdXRoLCB0aGlzLnBvc2l0aW9uLmVsZXZhdGlvbiwgdGhpcy5wb3NpdGlvbi5kaXN0YW5jZSk7XG4gICAgICAgIC8vIExvYWQgdGhlIG5ldyBwb3NpdGlvbiBpbiB0aGUgYmlxdWFkIGFuZCBkZWxheSBub3QgYWN0aXZlIChzZWNvbmRhcnlBdWRpb0dyYXBoKVxuICAgICAgICB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguc2V0Q29lZmZpY2llbnRzKGhydGZOZXh0UG9zaXRpb24uaWlyX2NvZWZmc19sZWZ0LCBocnRmTmV4dFBvc2l0aW9uLmlpcl9jb2VmZnNfcmlnaHQpO1xuICAgICAgICB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguc2V0RGVsYXkoaHJ0Zk5leHRQb3NpdGlvbi5pdGQgLyAxMDAwKTtcblxuICAgICAgICAvLyBEbyB0aGUgY3Jvc3NmYWRpbmcgYmV0d2VlbiBtYWluQXVkaW9HcmFwaCBhbmQgc2Vjb25kYXJ5QXVkaW9HcmFwaFxuICAgICAgICB0aGlzLmNyb3NzZmFkaW5nKCk7XG5cbiAgICAgICAgLy8gQ2hhbmdlIGN1cnJlbnQgbWFpbkF1ZGlvR3JhcGhcbiAgICAgICAgdmFyIGFjdGl2ZSA9IHRoaXMubWFpbkF1ZGlvR3JhcGg7XG4gICAgICAgIHRoaXMubWFpbkF1ZGlvR3JhcGggPSB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGg7XG4gICAgICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaCA9IGFjdGl2ZTtcblxuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBjdXJyZW50IHBvc2l0aW9uIG9mIHRoZSB2aXJ0dWFsIHNvdXJjZS5cbiAgICAgKiBAcHVibGljXG4gICAgICovXG4gICAgZ2V0UG9zaXRpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnBvc2l0aW9uO1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogUGF1c2UgcGxheWluZy5cbiAgICAgKiBAcHVibGljXG4gICAgICovXG4gICAgc2V0Q3Jvc3NmYWRlRHVyYXRpb24obXNSYW1wKSB7XG4gICAgICAgIC8vc2F2ZSBpbiBzZWNvbmRzXG4gICAgICAgIHRoaXMuY3Jvc3NmYWRlRHVyYXRpb24gPSBtc1JhbXAgLyAxMDAwO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNlZWsgYnVmZmVyIHBvc2l0aW9uIChpbiBzZWMpLlxuICAgICAqIEBwdWJsaWNcbiAgICAgKi9cbiAgICBnZXRDcm9zc2ZhZGVEdXJhdGlvbigpIHtcbiAgICAgICAgLy9yZXR1cm4gaW4gbXNcbiAgICAgICAgcmV0dXJuIGNyb3NzZmFkZUR1cmF0aW9uICogMTAwMDtcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIFJlbGVhc2UgcGxheWluZyBmbGFnIHdoZW4gdGhlIGVuZCBvZiB0aGUgYnVmZmVyIGlzIHJlYWNoZWQuXG4gICAgICogQHB1YmxpY1xuICAgICAqIEB0b2RvIEhhbmRsZSBzcGVlZCBjaGFuZ2VzLlxuICAgICAqL1xuICAgIGlzQ3Jvc3NmYWRpbmcoKSB7XG4gICAgICAgIC8vIFRoZSByYW1wcyBhcmUgbm90IGZpbmlzaGVkLCBzbyB0aGUgY3Jvc3NmYWRpbmcgaXMgbm90IGZpbmlzaGVkXG4gICAgICAgIGlmICh0aGlzLm1haW5BdWRpb0dyYXBoLmdhaW4udmFsdWUgIT09IDEpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIEhSVEYgZmlsZSBmb3IgYW4gZXNwZWNpZmljIHBvc2l0aW9uXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAcGFyYW0gYXppbXV0aCBBemltdXRoIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIC0xODAgZm9yIHNvdXJjZSBvbiB5b3VyIGxlZnQsIGFuZCBmcm9tIDAgdG8gMTgwIGZvciBzb3VyY2Ugb24geW91ciByaWdodFxuICAgICAqIEBwYXJhbSBlbGV2YXRpb24gRWxldmF0aW9uIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIDkwIGZvciBzb3VyY2UgYWJvdmUgeW91ciBoZWFkLCAwIGZvciBzb3VyY2UgaW4gZnJvbnQgb2YgeW91ciBoZWFkLCBhbmQgZnJvbSAwIHRvIC05MCBmb3Igc291cmNlIGJlbG93IHlvdXIgaGVhZClcbiAgICAgKiBAcGFyYW0gZGlzdGFuY2UgRGlzdGFuY2UgaW4gbWV0ZXJzXG4gICAgICovXG4gICAgZ2V0SFJURihhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKSB7XG4gICAgICAgIHZhciBuZWFyZXN0ID0gdGhpcy5nZXROZWFyZXN0UG9pbnQoYXppbXV0aCwgZWxldmF0aW9uLCBkaXN0YW5jZSk7XG4gICAgICAgIHZhciBocnRmID0gW107XG4gICAgICAgIGhydGYuaWlyX2NvZWZmc19sZWZ0ID0gbmVhcmVzdC5paXJfY29lZmZzX2xlZnQ7XG4gICAgICAgIGhydGYuaWlyX2NvZWZmc19yaWdodCA9IG5lYXJlc3QuaWlyX2NvZWZmc19yaWdodDtcbiAgICAgICAgaHJ0Zi5pdGQgPSBuZWFyZXN0Lml0ZDtcblxuICAgICAgICAvLyBSZXR1cm4gaHJ0ZiBkYXRhIG9mIG5lYXJlc3QgcG9zaXRpb24gZm9yIHRoZSBpbnB1dCB2YWx1ZXNcbiAgICAgICAgcmV0dXJuIGhydGY7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVHJhbnNmb3JtIHRoZSBzcGhlcmljYWwgdG8gY2FydGVzaWFuIGNvb3JkaW5hdGVzLlxuICAgICAqIEBwcml2YXRlXG4gICAgICogQHBhcmFtIGF6aW11dGggQXppbXV0aCBpbiByYWRpYW5zXG4gICAgICogQHBhcmFtIGVsZXZhdGlvbiBFbGV2YXRpb24gaW4gcmFkaWFuc1xuICAgICAqIEBwYXJhbSBkaXN0YW5jZSBEaXN0YW5jZSBpbiBtZXRlcnNcbiAgICAgKi9cbiAgICBzcGhlcmljYWxUb0NhcnRlc2lhbihhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB4OiBkaXN0YW5jZSAqIE1hdGguc2luKGF6aW11dGgpLFxuICAgICAgICAgICAgeTogZGlzdGFuY2UgKiBNYXRoLmNvcyhhemltdXRoKSxcbiAgICAgICAgICAgIHo6IGRpc3RhbmNlICogTWF0aC5zaW4oZWxldmF0aW9uKVxuICAgICAgICB9XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBHZXQgdGhlIG5lYXJlc3QgcG9zaXRpb24gZm9yIGFuIGlucHV0IHBvc2l0aW9uLlxuICAgICAqIEBwcml2YXRlXG4gICAgICogQHBhcmFtIGF6aW11dGggQXppbXV0aCBpbiBkZWdyZWVzICjCsCk6IGZyb20gMCB0byAtMTgwIGZvciBzb3VyY2Ugb24geW91ciBsZWZ0LCBhbmQgZnJvbSAwIHRvIDE4MCBmb3Igc291cmNlIG9uIHlvdXIgcmlnaHRcbiAgICAgKiBAcGFyYW0gZWxldmF0aW9uIEVsZXZhdGlvbiBpbiBkZWdyZWVzICjCsCk6IGZyb20gMCB0byA5MCBmb3Igc291cmNlIGFib3ZlIHlvdXIgaGVhZCwgMCBmb3Igc291cmNlIGluIGZyb250IG9mIHlvdXIgaGVhZCwgYW5kIGZyb20gMCB0byAtOTAgZm9yIHNvdXJjZSBiZWxvdyB5b3VyIGhlYWQpXG4gICAgICogQHBhcmFtIGRpc3RhbmNlIERpc3RhbmNlIGluIG1ldGVyc1xuICAgICAqL1xuICAgIGdldFJlYWxDb29yZGluYXRlcyhhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKSB7XG4gICAgICAgIHZhciBuZWFyZXN0ID0gdGhpcy5nZXROZWFyZXN0UG9pbnQoYXppbXV0aCwgZWxldmF0aW9uLCBkaXN0YW5jZSk7XG4gICAgICAgIC8vIFJldHVybiBhemltdXRoLCBlbGV2YXRpb24gYW5kIGRpc3RhbmNlIG9mIG5lYXJlc3QgcG9zaXRpb24gZm9yIHRoZSBpbnB1dCB2YWx1ZXNcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGF6aW11dGg6IG5lYXJlc3QuYXppbXV0aCxcbiAgICAgICAgICAgIGVsZXZhdGlvbjogbmVhcmVzdC5lbGV2YXRpb24sXG4gICAgICAgICAgICBkaXN0YW5jZTogbmVhcmVzdC5kaXN0YW5jZVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBuZWFyZXN0IHBvc2l0aW9uIGZvciBhbiBpbnB1dCBwb3NpdGlvbi5cbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqIEBwYXJhbSBhemltdXRoIEF6aW11dGggaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gLTE4MCBmb3Igc291cmNlIG9uIHlvdXIgbGVmdCwgYW5kIGZyb20gMCB0byAxODAgZm9yIHNvdXJjZSBvbiB5b3VyIHJpZ2h0XG4gICAgICogQHBhcmFtIGVsZXZhdGlvbiBFbGV2YXRpb24gaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gOTAgZm9yIHNvdXJjZSBhYm92ZSB5b3VyIGhlYWQsIDAgZm9yIHNvdXJjZSBpbiBmcm9udCBvZiB5b3VyIGhlYWQsIGFuZCBmcm9tIDAgdG8gLTkwIGZvciBzb3VyY2UgYmVsb3cgeW91ciBoZWFkKVxuICAgICAqIEBwYXJhbSBkaXN0YW5jZSBEaXN0YW5jZSBpbiBtZXRlcnNcbiAgICAgKi9cbiAgICBnZXROZWFyZXN0UG9pbnQoYXppbXV0aCwgZWxldmF0aW9uLCBkaXN0YW5jZSkge1xuICAgICAgICAvLyBEZWdyZWVzIHRvIHJhZGlhbnMgZm9yIHRoZSBhemltdXRoIGFuZCBlbGV2YXRpb25cbiAgICAgICAgdmFyIGF6aW11dGhSYWRpYW5zID0gYXppbXV0aCAqIE1hdGguUEkgLyAxODA7XG4gICAgICAgIHZhciBlbGV2YXRpb25SYWRpYW5zID0gZWxldmF0aW9uICogTWF0aC5QSSAvIDE4MDtcbiAgICAgICAgLy8gQ29udmVydCBzcGhlcmljYWwgY29vcmRpbmF0ZXMgdG8gY2FydGVzaWFuXG4gICAgICAgIHZhciBjYXJ0ZXNpYW5Db29yZCA9IHRoaXMuc3BoZXJpY2FsVG9DYXJ0ZXNpYW4oYXppbXV0aFJhZGlhbnMsIGVsZXZhdGlvblJhZGlhbnMsIGRpc3RhbmNlKTtcbiAgICAgICAgLy8gR2V0IHRoZSBuZWFyZXN0IEhSVEYgZmlsZSBmb3IgdGhlIGRlc2lyZWQgcG9zaXRpb25cbiAgICAgICAgdmFyIG5lYXJlc3QgPSB0aGlzLnRyZWUubmVhcmVzdChjYXJ0ZXNpYW5Db29yZCwgMSlbMF07XG5cbiAgICAgICAgcmV0dXJuIG5lYXJlc3RbMF07XG4gICAgfVxuXG5cbn07XG5cbi8qKlxuICogQXVkaW9HcmFwaCBzdWIgYXVkaW8gZ3JhcGggb2JqZWN0IGFzIGFuIEVDTUFTY3JpcHQ1IHByb3BlcnRpZXMgb2JqZWN0LlxuICovXG5cbmNsYXNzIFByb2Nlc3NpbmdBdWRpb0dyYXBoIHtcblxuXG4gICAgY29uc3RydWN0b3IoKSB7XG5cbiAgICAgICAgLy8gUHJpdmF0ZSBwcm9wZXJ0aWVzXG4gICAgICAgIHRoaXMuYmlxdWFkRmlsdGVyTGVmdCA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5iaXF1YWRGaWx0ZXJSaWdodCA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5mcmFjdGlvbmFsRGVsYXlMZWZ0ID0gdW5kZWZpbmVkO1xuICAgICAgICB0aGlzLmZyYWN0aW9uYWxEZWxheVJpZ2h0ID0gdW5kZWZpbmVkO1xuICAgICAgICB0aGlzLmdhaW5Ob2RlID0gdW5kZWZpbmVkO1xuICAgICAgICB0aGlzLmlucHV0ID0gdW5kZWZpbmVkO1xuICAgICAgICB0aGlzLnByb2Nlc3Nvck5vZGUgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuYnVmZmVyU2l6ZSA9IDEwMjQ7XG5cbiAgICAgICAgLy8gQ3JlYXRpb25zXG4gICAgICAgIHRoaXMuaW5wdXQgPSBhdWRpb0NvbnRleHQuY3JlYXRlR2FpbigpO1xuICAgICAgICB0aGlzLmdhaW5Ob2RlID0gYXVkaW9Db250ZXh0LmNyZWF0ZUdhaW4oKTtcbiAgICAgICAgdGhpcy5iaXF1YWRGaWx0ZXJMZWZ0ID0gbmV3IEJpcXVhZEZpbHRlcigpO1xuICAgICAgICB0aGlzLmJpcXVhZEZpbHRlclJpZ2h0ID0gbmV3IEJpcXVhZEZpbHRlcigpO1xuICAgICAgICB0aGlzLmZyYWN0aW9uYWxEZWxheUxlZnQgPSBuZXcgRnJhY3Rpb25hbERlbGF5KDQ0MTAwKTtcbiAgICAgICAgdGhpcy5mcmFjdGlvbmFsRGVsYXlSaWdodCA9IG5ldyBGcmFjdGlvbmFsRGVsYXkoNDQxMDApO1xuICAgICAgICB0aGlzLnByb2Nlc3Nvck5vZGUgPSBhdWRpb0NvbnRleHQuY3JlYXRlU2NyaXB0UHJvY2Vzc29yKHRoaXMuYnVmZmVyU2l6ZSk7XG4gICAgICAgIC8vIENvbm5lY3Rpb25zXG4gICAgICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLnByb2Nlc3Nvck5vZGUpO1xuICAgICAgICB0aGlzLnByb2Nlc3Nvck5vZGUuY29ubmVjdCh0aGlzLmdhaW5Ob2RlKTtcbiAgICAgICAgLy8gU3RhcnQgcHJvY2Vzc29yTm9kZVxuICAgICAgICB0aGlzLnByb2Nlc3Nvck5vZGVGdW5jdGlvbigpO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuXG4gICAgZ2V0IGdhaW4oKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdhaW5Ob2RlLmdhaW47XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBTZXQgY29lZmZpY2llbnRzIGJpcXVhZCBmaWx0ZXJcbiAgICAgKiBAcHVibGljXG4gICAgICogQHBhcmFtIHZhbHVlIEF1ZGlvQnVmZmVyIE9iamVjdC5cbiAgICAgKi9cbiAgICBzZXRDb2VmZmljaWVudHMobGVmdENvZWZmaWNpZW50cywgcmlnaHRDb2VmZmljaWVudHMpIHtcbiAgICAgICAgdGhpcy5iaXF1YWRGaWx0ZXJMZWZ0LnNldENvZWZmaWNpZW50cyhsZWZ0Q29lZmZpY2llbnRzKTtcbiAgICAgICAgdGhpcy5iaXF1YWRGaWx0ZXJSaWdodC5zZXRDb2VmZmljaWVudHMocmlnaHRDb2VmZmljaWVudHMpO1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogU2V0IGJ1ZmZlciBhbmQgYnVmZmVyRHVyYXRpb24uXG4gICAgICogQHB1YmxpY1xuICAgICAqIEBjaGFpbmFibGVcbiAgICAgKi9cbiAgICBzZXREZWxheShkZWxheSkge1xuICAgICAgICB2YXIgZGVsYXlMZWZ0ID0gMSAvIDEwMDAgKyBkZWxheSAvIDI7XG4gICAgICAgIHZhciBkZWxheVJpZ2h0ID0gMSAvIDEwMDAgLSBkZWxheSAvIDI7XG4gICAgICAgIHRoaXMuZnJhY3Rpb25hbERlbGF5TGVmdC5zZXREZWxheShkZWxheUxlZnQpO1xuICAgICAgICB0aGlzLmZyYWN0aW9uYWxEZWxheVJpZ2h0LnNldERlbGF5KGRlbGF5UmlnaHQpO1xuICAgIH1cblxuXG4gICAgcHJvY2Vzc29yTm9kZUZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XG4gICAgICAgIHRoaXMucHJvY2Vzc29yTm9kZS5vbmF1ZGlvcHJvY2VzcyA9IGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgICAgIC8vIEdldCB0aGUgaW5wdXRCdWZmZXJcbiAgICAgICAgICAgIHZhciBpbnB1dEFycmF5ID0gZS5pbnB1dEJ1ZmZlci5nZXRDaGFubmVsRGF0YSgwKTtcblxuICAgICAgICAgICAgLy8gR2V0IHRoZSBvdXRwdXRCdWZmZXJzXG4gICAgICAgICAgICB2YXIgbGVmdE91dHB1dEFycmF5ID0gZS5vdXRwdXRCdWZmZXIuZ2V0Q2hhbm5lbERhdGEoMCk7XG4gICAgICAgICAgICB2YXIgcmlnaHRPdXRwdXRBcnJheSA9IGUub3V0cHV0QnVmZmVyLmdldENoYW5uZWxEYXRhKDEpO1xuXG4gICAgICAgICAgICAvL0RlbGF5XG4gICAgICAgICAgICB2YXIgbWVkaXVtQXJyYXlMZWZ0ID0gbmV3IEZsb2F0MzJBcnJheSh0aGF0LmZyYWN0aW9uYWxEZWxheUxlZnQucHJvY2VzcyhpbnB1dEFycmF5KSk7XG4gICAgICAgICAgICB2YXIgbWVkaXVtQXJyYXlSaWdodCA9IG5ldyBGbG9hdDMyQXJyYXkodGhhdC5mcmFjdGlvbmFsRGVsYXlSaWdodC5wcm9jZXNzKGlucHV0QXJyYXkpKTtcblxuICAgICAgICAgICAgLy9CaXF1YWRGaWx0ZXJcbiAgICAgICAgICAgIHRoYXQuYmlxdWFkRmlsdGVyTGVmdC5wcm9jZXNzKG1lZGl1bUFycmF5TGVmdCwgbGVmdE91dHB1dEFycmF5KTtcbiAgICAgICAgICAgIHRoYXQuYmlxdWFkRmlsdGVyUmlnaHQucHJvY2VzcyhtZWRpdW1BcnJheVJpZ2h0LCByaWdodE91dHB1dEFycmF5KTtcbiAgICAgICAgfVxuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogQ29ubmVjdCB0aGUgY29udm9sdmVyQXVkaW9HcmFwaCB0byBhIG5vZGVcbiAgICAgKiBAcHVibGljXG4gICAgICogQGNoYWluYWJsZVxuICAgICAqIEBwYXJhbSBub2RlIERlc3RpbmF0aW9uIG5vZGVcbiAgICAgKi9cbiAgICBjb25uZWN0KG5vZGUpIHtcbiAgICAgICAgdGhpcy5nYWluTm9kZS5jb25uZWN0KG5vZGUpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBEaXNjb25uZWN0IHRoZSBjb252b2x2ZXJBdWRpb0dyYXBoIHRvIGEgbm9kZVxuICAgICAqIEBwdWJsaWNcbiAgICAgKiBAY2hhaW5hYmxlXG4gICAgICogQHBhcmFtIG5vZGUgRGVzdGluYXRpb24gbm9kZVxuICAgICAqL1xuICAgIGRpc2Nvbm5lY3Qobm9kZSkge1xuICAgICAgICB0aGlzLmdhaW5Ob2RlLmRpc2Nvbm5lY3Qobm9kZSk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuXG59XG5cbm1vZHVsZS5leHBvcnRzID0gQmluYXVyYWxNb2RlbGVkO1xuIiwiLyogQ29weXJpZ2h0IDIwMTMgQ2hyaXMgV2lsc29uXG5cbiAgIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gICB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gICBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcblxuICAgICAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuXG4gICBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gICBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gICBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAgIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAgIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuKi9cblxuLyogXG5cblRoaXMgbW9ua2V5cGF0Y2ggbGlicmFyeSBpcyBpbnRlbmRlZCB0byBiZSBpbmNsdWRlZCBpbiBwcm9qZWN0cyB0aGF0IGFyZVxud3JpdHRlbiB0byB0aGUgcHJvcGVyIEF1ZGlvQ29udGV4dCBzcGVjIChpbnN0ZWFkIG9mIHdlYmtpdEF1ZGlvQ29udGV4dCksIFxuYW5kIHRoYXQgdXNlIHRoZSBuZXcgbmFtaW5nIGFuZCBwcm9wZXIgYml0cyBvZiB0aGUgV2ViIEF1ZGlvIEFQSSAoZS5nLiBcbnVzaW5nIEJ1ZmZlclNvdXJjZU5vZGUuc3RhcnQoKSBpbnN0ZWFkIG9mIEJ1ZmZlclNvdXJjZU5vZGUubm90ZU9uKCkpLCBidXQgbWF5XG5oYXZlIHRvIHJ1biBvbiBzeXN0ZW1zIHRoYXQgb25seSBzdXBwb3J0IHRoZSBkZXByZWNhdGVkIGJpdHMuXG5cblRoaXMgbGlicmFyeSBzaG91bGQgYmUgaGFybWxlc3MgdG8gaW5jbHVkZSBpZiB0aGUgYnJvd3NlciBzdXBwb3J0cyBcbnVucHJlZml4ZWQgXCJBdWRpb0NvbnRleHRcIiwgYW5kL29yIGlmIGl0IHN1cHBvcnRzIHRoZSBuZXcgbmFtZXMuICBcblxuVGhlIHBhdGNoZXMgdGhpcyBsaWJyYXJ5IGhhbmRsZXM6XG5pZiB3aW5kb3cuQXVkaW9Db250ZXh0IGlzIHVuc3VwcG9ydGVkLCBpdCB3aWxsIGJlIGFsaWFzZWQgdG8gd2Via2l0QXVkaW9Db250ZXh0KCkuXG5pZiBBdWRpb0J1ZmZlclNvdXJjZU5vZGUuc3RhcnQoKSBpcyB1bmltcGxlbWVudGVkLCBpdCB3aWxsIGJlIHJvdXRlZCB0byBub3RlT24oKSBvclxubm90ZUdyYWluT24oKSwgZGVwZW5kaW5nIG9uIHBhcmFtZXRlcnMuXG5cblRoZSBmb2xsb3dpbmcgYWxpYXNlcyBvbmx5IHRha2UgZWZmZWN0IGlmIHRoZSBuZXcgbmFtZXMgYXJlIG5vdCBhbHJlYWR5IGluIHBsYWNlOlxuXG5BdWRpb0J1ZmZlclNvdXJjZU5vZGUuc3RvcCgpIGlzIGFsaWFzZWQgdG8gbm90ZU9mZigpXG5BdWRpb0NvbnRleHQuY3JlYXRlR2FpbigpIGlzIGFsaWFzZWQgdG8gY3JlYXRlR2Fpbk5vZGUoKVxuQXVkaW9Db250ZXh0LmNyZWF0ZURlbGF5KCkgaXMgYWxpYXNlZCB0byBjcmVhdGVEZWxheU5vZGUoKVxuQXVkaW9Db250ZXh0LmNyZWF0ZVNjcmlwdFByb2Nlc3NvcigpIGlzIGFsaWFzZWQgdG8gY3JlYXRlSmF2YVNjcmlwdE5vZGUoKVxuQXVkaW9Db250ZXh0LmNyZWF0ZVBlcmlvZGljV2F2ZSgpIGlzIGFsaWFzZWQgdG8gY3JlYXRlV2F2ZVRhYmxlKClcbk9zY2lsbGF0b3JOb2RlLnN0YXJ0KCkgaXMgYWxpYXNlZCB0byBub3RlT24oKVxuT3NjaWxsYXRvck5vZGUuc3RvcCgpIGlzIGFsaWFzZWQgdG8gbm90ZU9mZigpXG5Pc2NpbGxhdG9yTm9kZS5zZXRQZXJpb2RpY1dhdmUoKSBpcyBhbGlhc2VkIHRvIHNldFdhdmVUYWJsZSgpXG5BdWRpb1BhcmFtLnNldFRhcmdldEF0VGltZSgpIGlzIGFsaWFzZWQgdG8gc2V0VGFyZ2V0VmFsdWVBdFRpbWUoKVxuXG5UaGlzIGxpYnJhcnkgZG9lcyBOT1QgcGF0Y2ggdGhlIGVudW1lcmF0ZWQgdHlwZSBjaGFuZ2VzLCBhcyBpdCBpcyBcbnJlY29tbWVuZGVkIGluIHRoZSBzcGVjaWZpY2F0aW9uIHRoYXQgaW1wbGVtZW50YXRpb25zIHN1cHBvcnQgYm90aCBpbnRlZ2VyXG5hbmQgc3RyaW5nIHR5cGVzIGZvciBBdWRpb1Bhbm5lck5vZGUucGFubmluZ01vZGVsLCBBdWRpb1Bhbm5lck5vZGUuZGlzdGFuY2VNb2RlbCBcbkJpcXVhZEZpbHRlck5vZGUudHlwZSBhbmQgT3NjaWxsYXRvck5vZGUudHlwZS5cblxuKi9cbihmdW5jdGlvbiAoZ2xvYmFsLCBleHBvcnRzLCBwZXJmKSB7XG4gICd1c2Ugc3RyaWN0JztcblxuICBmdW5jdGlvbiBmaXhTZXRUYXJnZXQocGFyYW0pIHtcbiAgICBpZiAoIXBhcmFtKSAvLyBpZiBOWUksIGp1c3QgcmV0dXJuXG4gICAgICByZXR1cm47XG4gICAgaWYgKCFwYXJhbS5zZXRUYXJnZXRBdFRpbWUpXG4gICAgICBwYXJhbS5zZXRUYXJnZXRBdFRpbWUgPSBwYXJhbS5zZXRUYXJnZXRWYWx1ZUF0VGltZTsgXG4gIH1cblxuICBpZiAod2luZG93Lmhhc093blByb3BlcnR5KCd3ZWJraXRBdWRpb0NvbnRleHQnKSAmJiBcbiAgICAgICF3aW5kb3cuaGFzT3duUHJvcGVydHkoJ0F1ZGlvQ29udGV4dCcpKSB7XG4gICAgd2luZG93LkF1ZGlvQ29udGV4dCA9IHdlYmtpdEF1ZGlvQ29udGV4dDtcblxuICAgIGlmICghQXVkaW9Db250ZXh0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eSgnY3JlYXRlR2FpbicpKVxuICAgICAgQXVkaW9Db250ZXh0LnByb3RvdHlwZS5jcmVhdGVHYWluID0gQXVkaW9Db250ZXh0LnByb3RvdHlwZS5jcmVhdGVHYWluTm9kZTtcbiAgICBpZiAoIUF1ZGlvQ29udGV4dC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkoJ2NyZWF0ZURlbGF5JykpXG4gICAgICBBdWRpb0NvbnRleHQucHJvdG90eXBlLmNyZWF0ZURlbGF5ID0gQXVkaW9Db250ZXh0LnByb3RvdHlwZS5jcmVhdGVEZWxheU5vZGU7XG4gICAgaWYgKCFBdWRpb0NvbnRleHQucHJvdG90eXBlLmhhc093blByb3BlcnR5KCdjcmVhdGVTY3JpcHRQcm9jZXNzb3InKSlcbiAgICAgIEF1ZGlvQ29udGV4dC5wcm90b3R5cGUuY3JlYXRlU2NyaXB0UHJvY2Vzc29yID0gQXVkaW9Db250ZXh0LnByb3RvdHlwZS5jcmVhdGVKYXZhU2NyaXB0Tm9kZTtcbiAgICBpZiAoIUF1ZGlvQ29udGV4dC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkoJ2NyZWF0ZVBlcmlvZGljV2F2ZScpKVxuICAgICAgQXVkaW9Db250ZXh0LnByb3RvdHlwZS5jcmVhdGVQZXJpb2RpY1dhdmUgPSBBdWRpb0NvbnRleHQucHJvdG90eXBlLmNyZWF0ZVdhdmVUYWJsZTtcblxuXG4gICAgQXVkaW9Db250ZXh0LnByb3RvdHlwZS5pbnRlcm5hbF9jcmVhdGVHYWluID0gQXVkaW9Db250ZXh0LnByb3RvdHlwZS5jcmVhdGVHYWluO1xuICAgIEF1ZGlvQ29udGV4dC5wcm90b3R5cGUuY3JlYXRlR2FpbiA9IGZ1bmN0aW9uKCkgeyBcbiAgICAgIHZhciBub2RlID0gdGhpcy5pbnRlcm5hbF9jcmVhdGVHYWluKCk7XG4gICAgICBmaXhTZXRUYXJnZXQobm9kZS5nYWluKTtcbiAgICAgIHJldHVybiBub2RlO1xuICAgIH07XG5cbiAgICBBdWRpb0NvbnRleHQucHJvdG90eXBlLmludGVybmFsX2NyZWF0ZURlbGF5ID0gQXVkaW9Db250ZXh0LnByb3RvdHlwZS5jcmVhdGVEZWxheTtcbiAgICBBdWRpb0NvbnRleHQucHJvdG90eXBlLmNyZWF0ZURlbGF5ID0gZnVuY3Rpb24obWF4RGVsYXlUaW1lKSB7IFxuICAgICAgdmFyIG5vZGUgPSBtYXhEZWxheVRpbWUgPyB0aGlzLmludGVybmFsX2NyZWF0ZURlbGF5KG1heERlbGF5VGltZSkgOiB0aGlzLmludGVybmFsX2NyZWF0ZURlbGF5KCk7XG4gICAgICBmaXhTZXRUYXJnZXQobm9kZS5kZWxheVRpbWUpO1xuICAgICAgcmV0dXJuIG5vZGU7XG4gICAgfTtcblxuICAgIEF1ZGlvQ29udGV4dC5wcm90b3R5cGUuaW50ZXJuYWxfY3JlYXRlQnVmZmVyU291cmNlID0gQXVkaW9Db250ZXh0LnByb3RvdHlwZS5jcmVhdGVCdWZmZXJTb3VyY2U7XG4gICAgQXVkaW9Db250ZXh0LnByb3RvdHlwZS5jcmVhdGVCdWZmZXJTb3VyY2UgPSBmdW5jdGlvbigpIHsgXG4gICAgICB2YXIgbm9kZSA9IHRoaXMuaW50ZXJuYWxfY3JlYXRlQnVmZmVyU291cmNlKCk7XG4gICAgICBpZiAoIW5vZGUuc3RhcnQpIHtcbiAgICAgICAgbm9kZS5zdGFydCA9IGZ1bmN0aW9uICggd2hlbiwgb2Zmc2V0LCBkdXJhdGlvbiApIHtcbiAgICAgICAgICBpZiAoIG9mZnNldCB8fCBkdXJhdGlvbiApXG4gICAgICAgICAgICB0aGlzLm5vdGVHcmFpbk9uKCB3aGVuLCBvZmZzZXQsIGR1cmF0aW9uICk7XG4gICAgICAgICAgZWxzZVxuICAgICAgICAgICAgdGhpcy5ub3RlT24oIHdoZW4gKTtcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGlmICghbm9kZS5zdG9wKVxuICAgICAgICBub2RlLnN0b3AgPSBub2RlLm5vdGVPZmY7XG4gICAgICBmaXhTZXRUYXJnZXQobm9kZS5wbGF5YmFja1JhdGUpO1xuICAgICAgcmV0dXJuIG5vZGU7XG4gICAgfTtcblxuICAgIEF1ZGlvQ29udGV4dC5wcm90b3R5cGUuaW50ZXJuYWxfY3JlYXRlRHluYW1pY3NDb21wcmVzc29yID0gQXVkaW9Db250ZXh0LnByb3RvdHlwZS5jcmVhdGVEeW5hbWljc0NvbXByZXNzb3I7XG4gICAgQXVkaW9Db250ZXh0LnByb3RvdHlwZS5jcmVhdGVEeW5hbWljc0NvbXByZXNzb3IgPSBmdW5jdGlvbigpIHsgXG4gICAgICB2YXIgbm9kZSA9IHRoaXMuaW50ZXJuYWxfY3JlYXRlRHluYW1pY3NDb21wcmVzc29yKCk7XG4gICAgICBmaXhTZXRUYXJnZXQobm9kZS50aHJlc2hvbGQpO1xuICAgICAgZml4U2V0VGFyZ2V0KG5vZGUua25lZSk7XG4gICAgICBmaXhTZXRUYXJnZXQobm9kZS5yYXRpbyk7XG4gICAgICBmaXhTZXRUYXJnZXQobm9kZS5yZWR1Y3Rpb24pO1xuICAgICAgZml4U2V0VGFyZ2V0KG5vZGUuYXR0YWNrKTtcbiAgICAgIGZpeFNldFRhcmdldChub2RlLnJlbGVhc2UpO1xuICAgICAgcmV0dXJuIG5vZGU7XG4gICAgfTtcblxuICAgIEF1ZGlvQ29udGV4dC5wcm90b3R5cGUuaW50ZXJuYWxfY3JlYXRlQmlxdWFkRmlsdGVyID0gQXVkaW9Db250ZXh0LnByb3RvdHlwZS5jcmVhdGVCaXF1YWRGaWx0ZXI7XG4gICAgQXVkaW9Db250ZXh0LnByb3RvdHlwZS5jcmVhdGVCaXF1YWRGaWx0ZXIgPSBmdW5jdGlvbigpIHsgXG4gICAgICB2YXIgbm9kZSA9IHRoaXMuaW50ZXJuYWxfY3JlYXRlQmlxdWFkRmlsdGVyKCk7XG4gICAgICBmaXhTZXRUYXJnZXQobm9kZS5mcmVxdWVuY3kpO1xuICAgICAgZml4U2V0VGFyZ2V0KG5vZGUuZGV0dW5lKTtcbiAgICAgIGZpeFNldFRhcmdldChub2RlLlEpO1xuICAgICAgZml4U2V0VGFyZ2V0KG5vZGUuZ2Fpbik7XG4gICAgICByZXR1cm4gbm9kZTtcbiAgICB9O1xuXG4gICAgaWYgKEF1ZGlvQ29udGV4dC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkoICdjcmVhdGVPc2NpbGxhdG9yJyApKSB7XG4gICAgICBBdWRpb0NvbnRleHQucHJvdG90eXBlLmludGVybmFsX2NyZWF0ZU9zY2lsbGF0b3IgPSBBdWRpb0NvbnRleHQucHJvdG90eXBlLmNyZWF0ZU9zY2lsbGF0b3I7XG4gICAgICBBdWRpb0NvbnRleHQucHJvdG90eXBlLmNyZWF0ZU9zY2lsbGF0b3IgPSBmdW5jdGlvbigpIHsgXG4gICAgICAgIHZhciBub2RlID0gdGhpcy5pbnRlcm5hbF9jcmVhdGVPc2NpbGxhdG9yKCk7XG4gICAgICAgIGlmICghbm9kZS5zdGFydClcbiAgICAgICAgICBub2RlLnN0YXJ0ID0gbm9kZS5ub3RlT247IFxuICAgICAgICBpZiAoIW5vZGUuc3RvcClcbiAgICAgICAgICBub2RlLnN0b3AgPSBub2RlLm5vdGVPZmY7XG4gICAgICAgIGlmICghbm9kZS5zZXRQZXJpb2RpY1dhdmUpXG4gICAgICAgICAgbm9kZS5zZXRQZXJpb2RpY1dhdmUgPSBub2RlLnNldFdhdmVUYWJsZTtcbiAgICAgICAgZml4U2V0VGFyZ2V0KG5vZGUuZnJlcXVlbmN5KTtcbiAgICAgICAgZml4U2V0VGFyZ2V0KG5vZGUuZGV0dW5lKTtcbiAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICB9O1xuICAgIH1cbiAgfVxufSh3aW5kb3cpKTsiLCIvKmdsb2JhbHMgQXVkaW9Db250ZXh0Ki9cbnJlcXVpcmUoJy4vYWMtbW9ua2V5cGF0Y2gnKTtcbndpbmRvdy53YXZlcyA9IHdpbmRvdy53YXZlcyB8fCB7fTtcbm1vZHVsZS5leHBvcnRzID0gd2luZG93LndhdmVzLmF1ZGlvQ29udGV4dCA9IHdpbmRvdy53YXZlcy5hdWRpb0NvbnRleHQgfHwgbmV3IEF1ZGlvQ29udGV4dCgpOyIsIi8qKlxuICogQVVUSE9SIE9GIElOSVRJQUwgSlMgTElCUkFSWVxuICogay1kIFRyZWUgSmF2YVNjcmlwdCAtIFYgMS4wXG4gKlxuICogaHR0cHM6Ly9naXRodWIuY29tL3ViaWxhYnMva2QtdHJlZS1qYXZhc2NyaXB0XG4gKlxuICogQGF1dGhvciBNaXJjZWEgUHJpY29wIDxwcmljb3BAdWJpbGFicy5uZXQ+LCAyMDEyXG4gKiBAYXV0aG9yIE1hcnRpbiBLbGVwcGUgPGtsZXBwZUB1YmlsYWJzLm5ldD4sIDIwMTJcbiAqIEBhdXRob3IgVWJpbGFicyBodHRwOi8vdWJpbGFicy5uZXQsIDIwMTJcbiAqIEBsaWNlbnNlIE1JVCBMaWNlbnNlIDxodHRwOi8vd3d3Lm9wZW5zb3VyY2Uub3JnL2xpY2Vuc2VzL21pdC1saWNlbnNlLnBocD5cbiAqL1xuXG5cbmZ1bmN0aW9uIE5vZGUob2JqLCBkaW1lbnNpb24sIHBhcmVudCkge1xuICB0aGlzLm9iaiA9IG9iajtcbiAgdGhpcy5sZWZ0ID0gbnVsbDtcbiAgdGhpcy5yaWdodCA9IG51bGw7XG4gIHRoaXMucGFyZW50ID0gcGFyZW50O1xuICB0aGlzLmRpbWVuc2lvbiA9IGRpbWVuc2lvbjtcbn1cblxuZnVuY3Rpb24gS2RUcmVlKHBvaW50cywgbWV0cmljLCBkaW1lbnNpb25zKSB7XG5cbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBcbiAgZnVuY3Rpb24gYnVpbGRUcmVlKHBvaW50cywgZGVwdGgsIHBhcmVudCkge1xuICAgIHZhciBkaW0gPSBkZXB0aCAlIGRpbWVuc2lvbnMubGVuZ3RoLFxuICAgICAgbWVkaWFuLFxuICAgICAgbm9kZTtcblxuICAgIGlmIChwb2ludHMubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKHBvaW50cy5sZW5ndGggPT09IDEpIHtcbiAgICAgIHJldHVybiBuZXcgTm9kZShwb2ludHNbMF0sIGRpbSwgcGFyZW50KTtcbiAgICB9XG5cbiAgICBwb2ludHMuc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgICAgcmV0dXJuIGFbZGltZW5zaW9uc1tkaW1dXSAtIGJbZGltZW5zaW9uc1tkaW1dXTtcbiAgICB9KTtcblxuICAgIG1lZGlhbiA9IE1hdGguZmxvb3IocG9pbnRzLmxlbmd0aCAvIDIpO1xuICAgIG5vZGUgPSBuZXcgTm9kZShwb2ludHNbbWVkaWFuXSwgZGltLCBwYXJlbnQpO1xuICAgIG5vZGUubGVmdCA9IGJ1aWxkVHJlZShwb2ludHMuc2xpY2UoMCwgbWVkaWFuKSwgZGVwdGggKyAxLCBub2RlKTtcbiAgICBub2RlLnJpZ2h0ID0gYnVpbGRUcmVlKHBvaW50cy5zbGljZShtZWRpYW4gKyAxKSwgZGVwdGggKyAxLCBub2RlKTtcblxuICAgIHJldHVybiBub2RlO1xuICB9XG5cbiAgdGhpcy5yb290ID0gYnVpbGRUcmVlKHBvaW50cywgMCwgbnVsbCk7XG5cbiAgdGhpcy5pbnNlcnQgPSBmdW5jdGlvbiAocG9pbnQpIHtcbiAgICBmdW5jdGlvbiBpbm5lclNlYXJjaChub2RlLCBwYXJlbnQpIHtcblxuICAgICAgaWYgKG5vZGUgPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIHBhcmVudDtcbiAgICAgIH1cblxuICAgICAgdmFyIGRpbWVuc2lvbiA9IGRpbWVuc2lvbnNbbm9kZS5kaW1lbnNpb25dO1xuICAgICAgaWYgKHBvaW50W2RpbWVuc2lvbl0gPCBub2RlLm9ialtkaW1lbnNpb25dKSB7XG4gICAgICAgIHJldHVybiBpbm5lclNlYXJjaChub2RlLmxlZnQsIG5vZGUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIGlubmVyU2VhcmNoKG5vZGUucmlnaHQsIG5vZGUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHZhciBpbnNlcnRQb3NpdGlvbiA9IGlubmVyU2VhcmNoKHRoaXMucm9vdCwgbnVsbCksXG4gICAgICBuZXdOb2RlLFxuICAgICAgZGltZW5zaW9uO1xuXG4gICAgaWYgKGluc2VydFBvc2l0aW9uID09PSBudWxsKSB7XG4gICAgICB0aGlzLnJvb3QgPSBuZXcgTm9kZShwb2ludCwgMCwgbnVsbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbmV3Tm9kZSA9IG5ldyBOb2RlKHBvaW50LCAoaW5zZXJ0UG9zaXRpb24uZGltZW5zaW9uICsgMSkgJSBkaW1lbnNpb25zLmxlbmd0aCwgaW5zZXJ0UG9zaXRpb24pO1xuICAgIGRpbWVuc2lvbiA9IGRpbWVuc2lvbnNbaW5zZXJ0UG9zaXRpb24uZGltZW5zaW9uXTtcblxuICAgIGlmIChwb2ludFtkaW1lbnNpb25dIDwgaW5zZXJ0UG9zaXRpb24ub2JqW2RpbWVuc2lvbl0pIHtcbiAgICAgIGluc2VydFBvc2l0aW9uLmxlZnQgPSBuZXdOb2RlO1xuICAgIH0gZWxzZSB7XG4gICAgICBpbnNlcnRQb3NpdGlvbi5yaWdodCA9IG5ld05vZGU7XG4gICAgfVxuICB9O1xuXG4gIHRoaXMucmVtb3ZlID0gZnVuY3Rpb24gKHBvaW50KSB7XG4gICAgdmFyIG5vZGU7XG5cbiAgICBmdW5jdGlvbiBub2RlU2VhcmNoKG5vZGUpIHtcbiAgICAgIGlmIChub2RlID09PSBudWxsKSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuXG4gICAgICBpZiAobm9kZS5vYmogPT09IHBvaW50KSB7XG4gICAgICAgIHJldHVybiBub2RlO1xuICAgICAgfVxuXG4gICAgICB2YXIgZGltZW5zaW9uID0gZGltZW5zaW9uc1tub2RlLmRpbWVuc2lvbl07XG5cbiAgICAgIGlmIChwb2ludFtkaW1lbnNpb25dIDwgbm9kZS5vYmpbZGltZW5zaW9uXSkge1xuICAgICAgICByZXR1cm4gbm9kZVNlYXJjaChub2RlLmxlZnQsIG5vZGUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIG5vZGVTZWFyY2gobm9kZS5yaWdodCwgbm9kZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVtb3ZlTm9kZShub2RlKSB7XG4gICAgICB2YXIgbmV4dE5vZGUsXG4gICAgICAgIG5leHRPYmosXG4gICAgICAgIHBEaW1lbnNpb247XG5cbiAgICAgIGZ1bmN0aW9uIGZpbmRNYXgobm9kZSwgZGltKSB7XG4gICAgICAgIHZhciBkaW1lbnNpb24sXG4gICAgICAgICAgb3duLFxuICAgICAgICAgIGxlZnQsXG4gICAgICAgICAgcmlnaHQsXG4gICAgICAgICAgbWF4O1xuXG4gICAgICAgIGlmIChub2RlID09PSBudWxsKSB7XG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBkaW1lbnNpb24gPSBkaW1lbnNpb25zW2RpbV07XG4gICAgICAgIGlmIChub2RlLmRpbWVuc2lvbiA9PT0gZGltKSB7XG4gICAgICAgICAgaWYgKG5vZGUucmlnaHQgIT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybiBmaW5kTWF4KG5vZGUucmlnaHQsIGRpbSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBub2RlO1xuICAgICAgICB9XG5cbiAgICAgICAgb3duID0gbm9kZS5vYmpbZGltZW5zaW9uXTtcbiAgICAgICAgbGVmdCA9IGZpbmRNYXgobm9kZS5sZWZ0LCBkaW0pO1xuICAgICAgICByaWdodCA9IGZpbmRNYXgobm9kZS5yaWdodCwgZGltKTtcbiAgICAgICAgbWF4ID0gbm9kZTtcblxuICAgICAgICBpZiAobGVmdCAhPT0gbnVsbCAmJiBsZWZ0Lm9ialtkaW1lbnNpb25dID4gb3duKSB7XG4gICAgICAgICAgbWF4ID0gbGVmdDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChyaWdodCAhPT0gbnVsbCAmJiByaWdodC5vYmpbZGltZW5zaW9uXSA+IG1heC5vYmpbZGltZW5zaW9uXSkge1xuICAgICAgICAgIG1heCA9IHJpZ2h0O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBtYXg7XG4gICAgICB9XG5cbiAgICAgIGZ1bmN0aW9uIGZpbmRNaW4obm9kZSwgZGltKSB7XG4gICAgICAgIHZhciBkaW1lbnNpb24sXG4gICAgICAgICAgb3duLFxuICAgICAgICAgIGxlZnQsXG4gICAgICAgICAgcmlnaHQsXG4gICAgICAgICAgbWluO1xuXG4gICAgICAgIGlmIChub2RlID09PSBudWxsKSB7XG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBkaW1lbnNpb24gPSBkaW1lbnNpb25zW2RpbV07XG5cbiAgICAgICAgaWYgKG5vZGUuZGltZW5zaW9uID09PSBkaW0pIHtcbiAgICAgICAgICBpZiAobm9kZS5sZWZ0ICE9PSBudWxsKSB7XG4gICAgICAgICAgICByZXR1cm4gZmluZE1pbihub2RlLmxlZnQsIGRpbSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBub2RlO1xuICAgICAgICB9XG5cbiAgICAgICAgb3duID0gbm9kZS5vYmpbZGltZW5zaW9uXTtcbiAgICAgICAgbGVmdCA9IGZpbmRNaW4obm9kZS5sZWZ0LCBkaW0pO1xuICAgICAgICByaWdodCA9IGZpbmRNaW4obm9kZS5yaWdodCwgZGltKTtcbiAgICAgICAgbWluID0gbm9kZTtcblxuICAgICAgICBpZiAobGVmdCAhPT0gbnVsbCAmJiBsZWZ0Lm9ialtkaW1lbnNpb25dIDwgb3duKSB7XG4gICAgICAgICAgbWluID0gbGVmdDtcbiAgICAgICAgfVxuICAgICAgICBpZiAocmlnaHQgIT09IG51bGwgJiYgcmlnaHQub2JqW2RpbWVuc2lvbl0gPCBtaW4ub2JqW2RpbWVuc2lvbl0pIHtcbiAgICAgICAgICBtaW4gPSByaWdodDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbWluO1xuICAgICAgfVxuXG4gICAgICBpZiAobm9kZS5sZWZ0ID09PSBudWxsICYmIG5vZGUucmlnaHQgPT09IG51bGwpIHtcbiAgICAgICAgaWYgKG5vZGUucGFyZW50ID09PSBudWxsKSB7XG4gICAgICAgICAgc2VsZi5yb290ID0gbnVsbDtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBwRGltZW5zaW9uID0gZGltZW5zaW9uc1tub2RlLnBhcmVudC5kaW1lbnNpb25dO1xuXG4gICAgICAgIGlmIChub2RlLm9ialtwRGltZW5zaW9uXSA8IG5vZGUucGFyZW50Lm9ialtwRGltZW5zaW9uXSkge1xuICAgICAgICAgIG5vZGUucGFyZW50LmxlZnQgPSBudWxsO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG5vZGUucGFyZW50LnJpZ2h0ID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChub2RlLmxlZnQgIT09IG51bGwpIHtcbiAgICAgICAgbmV4dE5vZGUgPSBmaW5kTWF4KG5vZGUubGVmdCwgbm9kZS5kaW1lbnNpb24pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbmV4dE5vZGUgPSBmaW5kTWluKG5vZGUucmlnaHQsIG5vZGUuZGltZW5zaW9uKTtcbiAgICAgIH1cblxuICAgICAgbmV4dE9iaiA9IG5leHROb2RlLm9iajtcbiAgICAgIHJlbW92ZU5vZGUobmV4dE5vZGUpO1xuICAgICAgbm9kZS5vYmogPSBuZXh0T2JqO1xuXG4gICAgfVxuXG4gICAgbm9kZSA9IG5vZGVTZWFyY2goc2VsZi5yb290KTtcblxuICAgIGlmIChub2RlID09PSBudWxsKSB7IHJldHVybjsgfVxuXG4gICAgcmVtb3ZlTm9kZShub2RlKTtcbiAgfTtcblxuICB0aGlzLm5lYXJlc3QgPSBmdW5jdGlvbiAocG9pbnQsIG1heE5vZGVzLCBtYXhEaXN0YW5jZSkge1xuICAgIHZhciBpLFxuICAgICAgcmVzdWx0LFxuICAgICAgYmVzdE5vZGVzO1xuXG4gICAgYmVzdE5vZGVzID0gbmV3IEJpbmFyeUhlYXAoXG4gICAgICBmdW5jdGlvbiAoZSkgeyByZXR1cm4gLWVbMV07IH1cbiAgICApO1xuXG4gICAgZnVuY3Rpb24gbmVhcmVzdFNlYXJjaChub2RlKSB7XG4gICAgICB2YXIgYmVzdENoaWxkLFxuICAgICAgICBkaW1lbnNpb24gPSBkaW1lbnNpb25zW25vZGUuZGltZW5zaW9uXSxcbiAgICAgICAgb3duRGlzdGFuY2UgPSBtZXRyaWMocG9pbnQsIG5vZGUub2JqKSxcbiAgICAgICAgbGluZWFyUG9pbnQgPSB7fSxcbiAgICAgICAgbGluZWFyRGlzdGFuY2UsXG4gICAgICAgIG90aGVyQ2hpbGQsXG4gICAgICAgIGk7XG5cbiAgICAgIGZ1bmN0aW9uIHNhdmVOb2RlKG5vZGUsIGRpc3RhbmNlKSB7XG4gICAgICAgIGJlc3ROb2Rlcy5wdXNoKFtub2RlLCBkaXN0YW5jZV0pO1xuICAgICAgICBpZiAoYmVzdE5vZGVzLnNpemUoKSA+IG1heE5vZGVzKSB7XG4gICAgICAgICAgYmVzdE5vZGVzLnBvcCgpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZvciAoaSA9IDA7IGkgPCBkaW1lbnNpb25zLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIGlmIChpID09PSBub2RlLmRpbWVuc2lvbikge1xuICAgICAgICAgIGxpbmVhclBvaW50W2RpbWVuc2lvbnNbaV1dID0gcG9pbnRbZGltZW5zaW9uc1tpXV07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbGluZWFyUG9pbnRbZGltZW5zaW9uc1tpXV0gPSBub2RlLm9ialtkaW1lbnNpb25zW2ldXTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBsaW5lYXJEaXN0YW5jZSA9IG1ldHJpYyhsaW5lYXJQb2ludCwgbm9kZS5vYmopO1xuXG4gICAgICBpZiAobm9kZS5yaWdodCA9PT0gbnVsbCAmJiBub2RlLmxlZnQgPT09IG51bGwpIHtcbiAgICAgICAgaWYgKGJlc3ROb2Rlcy5zaXplKCkgPCBtYXhOb2RlcyB8fCBvd25EaXN0YW5jZSA8IGJlc3ROb2Rlcy5wZWVrKClbMV0pIHtcbiAgICAgICAgICBzYXZlTm9kZShub2RlLCBvd25EaXN0YW5jZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAobm9kZS5yaWdodCA9PT0gbnVsbCkge1xuICAgICAgICBiZXN0Q2hpbGQgPSBub2RlLmxlZnQ7XG4gICAgICB9IGVsc2UgaWYgKG5vZGUubGVmdCA9PT0gbnVsbCkge1xuICAgICAgICBiZXN0Q2hpbGQgPSBub2RlLnJpZ2h0O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHBvaW50W2RpbWVuc2lvbl0gPCBub2RlLm9ialtkaW1lbnNpb25dKSB7XG4gICAgICAgICAgYmVzdENoaWxkID0gbm9kZS5sZWZ0O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGJlc3RDaGlsZCA9IG5vZGUucmlnaHQ7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgbmVhcmVzdFNlYXJjaChiZXN0Q2hpbGQpO1xuXG4gICAgICBpZiAoYmVzdE5vZGVzLnNpemUoKSA8IG1heE5vZGVzIHx8IG93bkRpc3RhbmNlIDwgYmVzdE5vZGVzLnBlZWsoKVsxXSkge1xuICAgICAgICBzYXZlTm9kZShub2RlLCBvd25EaXN0YW5jZSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChiZXN0Tm9kZXMuc2l6ZSgpIDwgbWF4Tm9kZXMgfHwgTWF0aC5hYnMobGluZWFyRGlzdGFuY2UpIDwgYmVzdE5vZGVzLnBlZWsoKVsxXSkge1xuICAgICAgICBpZiAoYmVzdENoaWxkID09PSBub2RlLmxlZnQpIHtcbiAgICAgICAgICBvdGhlckNoaWxkID0gbm9kZS5yaWdodDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBvdGhlckNoaWxkID0gbm9kZS5sZWZ0O1xuICAgICAgICB9XG4gICAgICAgIGlmIChvdGhlckNoaWxkICE9PSBudWxsKSB7XG4gICAgICAgICAgbmVhcmVzdFNlYXJjaChvdGhlckNoaWxkKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChtYXhEaXN0YW5jZSkge1xuICAgICAgZm9yIChpID0gMDsgaSA8IG1heE5vZGVzOyBpICs9IDEpIHtcbiAgICAgICAgYmVzdE5vZGVzLnB1c2goW251bGwsIG1heERpc3RhbmNlXSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgbmVhcmVzdFNlYXJjaChzZWxmLnJvb3QpO1xuXG4gICAgcmVzdWx0ID0gW107XG5cbiAgICBmb3IgKGkgPSAwOyBpIDwgbWF4Tm9kZXM7IGkgKz0gMSkge1xuICAgICAgaWYgKGJlc3ROb2Rlcy5jb250ZW50W2ldWzBdKSB7XG4gICAgICAgIHJlc3VsdC5wdXNoKFtiZXN0Tm9kZXMuY29udGVudFtpXVswXS5vYmosIGJlc3ROb2Rlcy5jb250ZW50W2ldWzFdXSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgdGhpcy5iYWxhbmNlRmFjdG9yID0gZnVuY3Rpb24gKCkge1xuICAgIGZ1bmN0aW9uIGhlaWdodChub2RlKSB7XG4gICAgICBpZiAobm9kZSA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gMDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBNYXRoLm1heChoZWlnaHQobm9kZS5sZWZ0KSwgaGVpZ2h0KG5vZGUucmlnaHQpKSArIDE7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY291bnQobm9kZSkge1xuICAgICAgaWYgKG5vZGUgPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgICB9XG4gICAgICByZXR1cm4gY291bnQobm9kZS5sZWZ0KSArIGNvdW50KG5vZGUucmlnaHQpICsgMTtcbiAgICB9XG5cbiAgICByZXR1cm4gaGVpZ2h0KHNlbGYucm9vdCkgLyAoTWF0aC5sb2coY291bnQoc2VsZi5yb290KSkgLyBNYXRoLmxvZygyKSk7XG4gIH07XG59XG5cbi8vIEJpbmFyeSBoZWFwIGltcGxlbWVudGF0aW9uIGZyb206XG4vLyBodHRwOi8vZWxvcXVlbnRqYXZhc2NyaXB0Lm5ldC9hcHBlbmRpeDIuaHRtbFxuXG5mdW5jdGlvbiBCaW5hcnlIZWFwKHNjb3JlRnVuY3Rpb24pe1xuICB0aGlzLmNvbnRlbnQgPSBbXTtcbiAgdGhpcy5zY29yZUZ1bmN0aW9uID0gc2NvcmVGdW5jdGlvbjtcbn1cblxuQmluYXJ5SGVhcC5wcm90b3R5cGUgPSB7XG4gIHB1c2g6IGZ1bmN0aW9uKGVsZW1lbnQpIHtcbiAgICAvLyBBZGQgdGhlIG5ldyBlbGVtZW50IHRvIHRoZSBlbmQgb2YgdGhlIGFycmF5LlxuICAgIHRoaXMuY29udGVudC5wdXNoKGVsZW1lbnQpO1xuICAgIC8vIEFsbG93IGl0IHRvIGJ1YmJsZSB1cC5cbiAgICB0aGlzLmJ1YmJsZVVwKHRoaXMuY29udGVudC5sZW5ndGggLSAxKTtcbiAgfSxcblxuICBwb3A6IGZ1bmN0aW9uKCkge1xuICAgIC8vIFN0b3JlIHRoZSBmaXJzdCBlbGVtZW50IHNvIHdlIGNhbiByZXR1cm4gaXQgbGF0ZXIuXG4gICAgdmFyIHJlc3VsdCA9IHRoaXMuY29udGVudFswXTtcbiAgICAvLyBHZXQgdGhlIGVsZW1lbnQgYXQgdGhlIGVuZCBvZiB0aGUgYXJyYXkuXG4gICAgdmFyIGVuZCA9IHRoaXMuY29udGVudC5wb3AoKTtcbiAgICAvLyBJZiB0aGVyZSBhcmUgYW55IGVsZW1lbnRzIGxlZnQsIHB1dCB0aGUgZW5kIGVsZW1lbnQgYXQgdGhlXG4gICAgLy8gc3RhcnQsIGFuZCBsZXQgaXQgc2luayBkb3duLlxuICAgIGlmICh0aGlzLmNvbnRlbnQubGVuZ3RoID4gMCkge1xuICAgICAgdGhpcy5jb250ZW50WzBdID0gZW5kO1xuICAgICAgdGhpcy5zaW5rRG93bigwKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSxcblxuICBwZWVrOiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5jb250ZW50WzBdO1xuICB9LFxuXG4gIHJlbW92ZTogZnVuY3Rpb24obm9kZSkge1xuICAgIHZhciBsZW4gPSB0aGlzLmNvbnRlbnQubGVuZ3RoO1xuICAgIC8vIFRvIHJlbW92ZSBhIHZhbHVlLCB3ZSBtdXN0IHNlYXJjaCB0aHJvdWdoIHRoZSBhcnJheSB0byBmaW5kXG4gICAgLy8gaXQuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgICAgaWYgKHRoaXMuY29udGVudFtpXSA9PSBub2RlKSB7XG4gICAgICAgIC8vIFdoZW4gaXQgaXMgZm91bmQsIHRoZSBwcm9jZXNzIHNlZW4gaW4gJ3BvcCcgaXMgcmVwZWF0ZWRcbiAgICAgICAgLy8gdG8gZmlsbCB1cCB0aGUgaG9sZS5cbiAgICAgICAgdmFyIGVuZCA9IHRoaXMuY29udGVudC5wb3AoKTtcbiAgICAgICAgaWYgKGkgIT0gbGVuIC0gMSkge1xuICAgICAgICAgIHRoaXMuY29udGVudFtpXSA9IGVuZDtcbiAgICAgICAgICBpZiAodGhpcy5zY29yZUZ1bmN0aW9uKGVuZCkgPCB0aGlzLnNjb3JlRnVuY3Rpb24obm9kZSkpXG4gICAgICAgICAgICB0aGlzLmJ1YmJsZVVwKGkpO1xuICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgIHRoaXMuc2lua0Rvd24oaSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJOb2RlIG5vdCBmb3VuZC5cIik7XG4gIH0sXG5cbiAgc2l6ZTogZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuY29udGVudC5sZW5ndGg7XG4gIH0sXG5cbiAgYnViYmxlVXA6IGZ1bmN0aW9uKG4pIHtcbiAgICAvLyBGZXRjaCB0aGUgZWxlbWVudCB0aGF0IGhhcyB0byBiZSBtb3ZlZC5cbiAgICB2YXIgZWxlbWVudCA9IHRoaXMuY29udGVudFtuXTtcbiAgICAvLyBXaGVuIGF0IDAsIGFuIGVsZW1lbnQgY2FuIG5vdCBnbyB1cCBhbnkgZnVydGhlci5cbiAgICB3aGlsZSAobiA+IDApIHtcbiAgICAgIC8vIENvbXB1dGUgdGhlIHBhcmVudCBlbGVtZW50J3MgaW5kZXgsIGFuZCBmZXRjaCBpdC5cbiAgICAgIHZhciBwYXJlbnROID0gTWF0aC5mbG9vcigobiArIDEpIC8gMikgLSAxLFxuICAgICAgICAgIHBhcmVudCA9IHRoaXMuY29udGVudFtwYXJlbnROXTtcbiAgICAgIC8vIFN3YXAgdGhlIGVsZW1lbnRzIGlmIHRoZSBwYXJlbnQgaXMgZ3JlYXRlci5cbiAgICAgIGlmICh0aGlzLnNjb3JlRnVuY3Rpb24oZWxlbWVudCkgPCB0aGlzLnNjb3JlRnVuY3Rpb24ocGFyZW50KSkge1xuICAgICAgICB0aGlzLmNvbnRlbnRbcGFyZW50Tl0gPSBlbGVtZW50O1xuICAgICAgICB0aGlzLmNvbnRlbnRbbl0gPSBwYXJlbnQ7XG4gICAgICAgIC8vIFVwZGF0ZSAnbicgdG8gY29udGludWUgYXQgdGhlIG5ldyBwb3NpdGlvbi5cbiAgICAgICAgbiA9IHBhcmVudE47XG4gICAgICB9XG4gICAgICAvLyBGb3VuZCBhIHBhcmVudCB0aGF0IGlzIGxlc3MsIG5vIG5lZWQgdG8gbW92ZSBpdCBmdXJ0aGVyLlxuICAgICAgZWxzZSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfSxcblxuICBzaW5rRG93bjogZnVuY3Rpb24obikge1xuICAgIC8vIExvb2sgdXAgdGhlIHRhcmdldCBlbGVtZW50IGFuZCBpdHMgc2NvcmUuXG4gICAgdmFyIGxlbmd0aCA9IHRoaXMuY29udGVudC5sZW5ndGgsXG4gICAgICAgIGVsZW1lbnQgPSB0aGlzLmNvbnRlbnRbbl0sXG4gICAgICAgIGVsZW1TY29yZSA9IHRoaXMuc2NvcmVGdW5jdGlvbihlbGVtZW50KTtcblxuICAgIHdoaWxlKHRydWUpIHtcbiAgICAgIC8vIENvbXB1dGUgdGhlIGluZGljZXMgb2YgdGhlIGNoaWxkIGVsZW1lbnRzLlxuICAgICAgdmFyIGNoaWxkMk4gPSAobiArIDEpICogMiwgY2hpbGQxTiA9IGNoaWxkMk4gLSAxO1xuICAgICAgLy8gVGhpcyBpcyB1c2VkIHRvIHN0b3JlIHRoZSBuZXcgcG9zaXRpb24gb2YgdGhlIGVsZW1lbnQsXG4gICAgICAvLyBpZiBhbnkuXG4gICAgICB2YXIgc3dhcCA9IG51bGw7XG4gICAgICAvLyBJZiB0aGUgZmlyc3QgY2hpbGQgZXhpc3RzIChpcyBpbnNpZGUgdGhlIGFycmF5KS4uLlxuICAgICAgaWYgKGNoaWxkMU4gPCBsZW5ndGgpIHtcbiAgICAgICAgLy8gTG9vayBpdCB1cCBhbmQgY29tcHV0ZSBpdHMgc2NvcmUuXG4gICAgICAgIHZhciBjaGlsZDEgPSB0aGlzLmNvbnRlbnRbY2hpbGQxTl0sXG4gICAgICAgICAgICBjaGlsZDFTY29yZSA9IHRoaXMuc2NvcmVGdW5jdGlvbihjaGlsZDEpO1xuICAgICAgICAvLyBJZiB0aGUgc2NvcmUgaXMgbGVzcyB0aGFuIG91ciBlbGVtZW50J3MsIHdlIG5lZWQgdG8gc3dhcC5cbiAgICAgICAgaWYgKGNoaWxkMVNjb3JlIDwgZWxlbVNjb3JlKVxuICAgICAgICAgIHN3YXAgPSBjaGlsZDFOO1xuICAgICAgfVxuICAgICAgLy8gRG8gdGhlIHNhbWUgY2hlY2tzIGZvciB0aGUgb3RoZXIgY2hpbGQuXG4gICAgICBpZiAoY2hpbGQyTiA8IGxlbmd0aCkge1xuICAgICAgICB2YXIgY2hpbGQyID0gdGhpcy5jb250ZW50W2NoaWxkMk5dLFxuICAgICAgICAgICAgY2hpbGQyU2NvcmUgPSB0aGlzLnNjb3JlRnVuY3Rpb24oY2hpbGQyKTtcbiAgICAgICAgaWYgKGNoaWxkMlNjb3JlIDwgKHN3YXAgPT0gbnVsbCA/IGVsZW1TY29yZSA6IGNoaWxkMVNjb3JlKSl7XG4gICAgICAgICAgc3dhcCA9IGNoaWxkMk47XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gSWYgdGhlIGVsZW1lbnQgbmVlZHMgdG8gYmUgbW92ZWQsIHN3YXAgaXQsIGFuZCBjb250aW51ZS5cbiAgICAgIGlmIChzd2FwICE9IG51bGwpIHtcbiAgICAgICAgdGhpcy5jb250ZW50W25dID0gdGhpcy5jb250ZW50W3N3YXBdO1xuICAgICAgICB0aGlzLmNvbnRlbnRbc3dhcF0gPSBlbGVtZW50O1xuICAgICAgICBuID0gc3dhcDtcbiAgICAgIH1cbiAgICAgIC8vIE90aGVyd2lzZSwgd2UgYXJlIGRvbmUuXG4gICAgICBlbHNlIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgY3JlYXRlS2RUcmVlOiBmdW5jdGlvbiAocG9pbnRzLCBtZXRyaWMsIGRpbWVuc2lvbnMpIHtcbiAgICByZXR1cm4gbmV3IEtkVHJlZShwb2ludHMsIG1ldHJpYywgZGltZW5zaW9ucylcbiAgfVxufVxuIl19
