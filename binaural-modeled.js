!function(e){if("object"==typeof exports)module.exports=e();else if("function"==typeof define&&define.amd)define(e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.BinauralModeled=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
"use strict";
var kdt = _dereq_('kdt');
var audioContext = _dereq_("audio-context");
var BiquadFilter = _dereq_("biquad-filter");
var FractionalDelay = _dereq_("fractional-delay");
var BinauralModeled = function BinauralModeled() {
  this.hrtfDataset = undefined;
  this.hrtfDatasetLength = undefined;
  this.nextPosition = [];
  this.changeWhenFinishCrossfading = false;
  this.position = [];
  this.crossfadeDuration = 20 / 1000;
  this.bufferSize = 1024;
  this.tree = -1;
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
},{"audio-context":3,"biquad-filter":4,"fractional-delay":5,"kdt":6}],2:[function(_dereq_,module,exports){
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
},{}],3:[function(_dereq_,module,exports){
/*globals AudioContext*/
_dereq_('./ac-monkeypatch');
window.waves = window.waves || {};
module.exports = window.waves.audioContext = window.waves.audioContext || new AudioContext();
},{"./ac-monkeypatch":2}],4:[function(_dereq_,module,exports){
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
},{}],5:[function(_dereq_,module,exports){
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
},{}],6:[function(_dereq_,module,exports){
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi9Vc2Vycy9nb2xkc3ptaWR0L3NhbS9wcm8vZGV2L2JpbmF1cmFsTW9kZWxlZC9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1wYWNrL19wcmVsdWRlLmpzIiwiL1VzZXJzL2dvbGRzem1pZHQvc2FtL3Byby9kZXYvYmluYXVyYWxNb2RlbGVkL2JpbmF1cmFsLW1vZGVsZWQuZXM2LmpzIiwiL1VzZXJzL2dvbGRzem1pZHQvc2FtL3Byby9kZXYvYmluYXVyYWxNb2RlbGVkL25vZGVfbW9kdWxlcy9hdWRpby1jb250ZXh0L2FjLW1vbmtleXBhdGNoLmpzIiwiL1VzZXJzL2dvbGRzem1pZHQvc2FtL3Byby9kZXYvYmluYXVyYWxNb2RlbGVkL25vZGVfbW9kdWxlcy9hdWRpby1jb250ZXh0L2F1ZGlvLWNvbnRleHQuanMiLCIuLi8uLi8uLi8uLi8uLi8uLi91c3IvbG9jYWwvbGliL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIvVXNlcnMvZ29sZHN6bWlkdC9zYW0vcHJvL2Rldi9iaW5hdXJhbE1vZGVsZWQvbm9kZV9tb2R1bGVzL2tkdC9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ01BO0FBQUEsQUFBSSxFQUFBLENBQUEsR0FBRSxFQUFJLENBQUEsT0FBTSxBQUFDLENBQUMsS0FBSSxDQUFDLENBQUM7QUFDeEIsQUFBSSxFQUFBLENBQUEsWUFBVyxFQUFJLENBQUEsT0FBTSxBQUFDLENBQUMsZUFBYyxDQUFDLENBQUM7QUFDM0MsQUFBSSxFQUFBLENBQUEsWUFBVyxFQUFJLENBQUEsT0FBTSxBQUFDLENBQUMsZUFBYyxDQUFDLENBQUM7QUFDM0MsQUFBSSxFQUFBLENBQUEsZUFBYyxFQUFJLENBQUEsT0FBTSxBQUFDLENBQUMsa0JBQWlCLENBQUMsQ0FBQztBQVRqRCxBQUFJLEVBQUEsa0JBY0osU0FBTSxnQkFBYyxDQU9MLEFB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O0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpfXZhciBmPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChmLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGYsZi5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKipcbiAqIEBmaWxlT3ZlcnZpZXdcbiAqXG4gKiBAYXV0aG9yIEFybmF1IEp1bGnDoCA8QXJuYXUuSnVsaWFAZ21haWwuY29tPlxuICogQHZlcnNpb24gMC4xLjBcbiAqL1xudmFyIGtkdCA9IHJlcXVpcmUoJ2tkdCcpO1xudmFyIGF1ZGlvQ29udGV4dCA9IHJlcXVpcmUoXCJhdWRpby1jb250ZXh0XCIpO1xudmFyIEJpcXVhZEZpbHRlciA9IHJlcXVpcmUoXCJiaXF1YWQtZmlsdGVyXCIpO1xudmFyIEZyYWN0aW9uYWxEZWxheSA9IHJlcXVpcmUoXCJmcmFjdGlvbmFsLWRlbGF5XCIpO1xuXG4vKipcbiAqIEBjbGFzcyBCaW5hdXJhbE1vZGVsZWRcbiAqL1xuY2xhc3MgQmluYXVyYWxNb2RlbGVkIHtcblxuICAgIC8qKlxuICAgICAqIE1hbmRhdG9yeSBpbml0aWFsaXphdGlvbiBtZXRob2QuXG4gICAgICogQHB1YmxpY1xuICAgICAqIEBjaGFpbmFibGVcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3RvcigpIHtcbiAgICAgICAgLy8gUHJpdmF0ZSBwcm9wZXJ0aWVzXG4gICAgICAgIHRoaXMuaHJ0ZkRhdGFzZXQgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuaHJ0ZkRhdGFzZXRMZW5ndGggPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMubmV4dFBvc2l0aW9uID0gW107XG4gICAgICAgIHRoaXMuY2hhbmdlV2hlbkZpbmlzaENyb3NzZmFkaW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMucG9zaXRpb24gPSBbXVxuICAgICAgICB0aGlzLmNyb3NzZmFkZUR1cmF0aW9uID0gMjAgLyAxMDAwXG4gICAgICAgIHRoaXMuYnVmZmVyU2l6ZSA9IDEwMjQ7XG4gICAgICAgIHRoaXMudHJlZSA9IC0xO1xuXG4gICAgICAgIHRoaXMuaW5wdXQgPSBhdWRpb0NvbnRleHQuY3JlYXRlR2FpbigpO1xuXG4gICAgICAgIC8vIFR3byBzdWIgYXVkaW8gZ3JhcGhzIGNyZWF0aW9uOlxuICAgICAgICAvLyAtIG1haW5Db252b2x2ZXIgd2hpY2ggcmVwcmVzZW50cyB0aGUgY3VycmVudCBzdGF0ZVxuICAgICAgICAvLyAtIGFuZCBzZWNvbmRhcnlDb252b2x2ZXIgd2hpY2ggcmVwcmVzZW50cyB0aGUgcG90ZW50aWFsIHRhcmdldCBzdGF0ZVxuICAgICAgICAvLyAgIHdoZW4gbW92aW5nIHNvdW5kIHRvIGEgbmV3IHBvc2l0aW9uXG5cbiAgICAgICAgdGhpcy5tYWluQXVkaW9HcmFwaCA9IG5ldyBQcm9jZXNzaW5nQXVkaW9HcmFwaCgpO1xuICAgICAgICB0aGlzLm1haW5BdWRpb0dyYXBoLmdhaW4udmFsdWUgPSAxO1xuICAgICAgICB0aGlzLmlucHV0LmNvbm5lY3QodGhpcy5tYWluQXVkaW9HcmFwaC5pbnB1dCk7XG5cbiAgICAgICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoID0gbmV3IFByb2Nlc3NpbmdBdWRpb0dyYXBoKCk7XG4gICAgICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5nYWluLnZhbHVlID0gMDtcbiAgICAgICAgdGhpcy5pbnB1dC5jb25uZWN0KHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5pbnB1dCk7XG4gICAgICAgIC8vIFdlYiBBdWRpb1xuICAgICAgICB0aGlzLnNhbXBsZVJhdGUgPSBhdWRpb0NvbnRleHQuc2FtcGxlUmF0ZTtcbiAgICAgICAgLy9Db25uZWN0aW9uc1xuICAgICAgICB0aGlzLmlucHV0LmNvbm5lY3QodGhpcy5tYWluQXVkaW9HcmFwaC5pbnB1dCk7XG4gICAgICAgIHRoaXMuaW5wdXQuY29ubmVjdCh0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguaW5wdXQpO1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogQ29ubmVjdHMgdGhlIGJpbmF1cmFsTW9kZWxlZE5vZGUgdG8gdGhlIFdlYiBBdWRpbyBncmFwaFxuICAgICAqIEBwdWJsaWNcbiAgICAgKiBAY2hhaW5hYmxlXG4gICAgICogQHBhcmFtIG5vZGUgRGVzdGluYXRpb24gbm9kZVxuICAgICAqL1xuICAgIGNvbm5lY3Qobm9kZSkge1xuICAgICAgICB0aGlzLm1haW5BdWRpb0dyYXBoLmNvbm5lY3Qobm9kZSk7XG4gICAgICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5jb25uZWN0KG5vZGUpO1xuICAgICAgICByZXR1cm4gdGhpczsgLy8gRm9yIGNoYWluYWJpbGl0eVxuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogRGlzY29ubmVjdCB0aGUgYmluYXVyYWxNb2RlbGVkTm9kZSBmcm9tIHRoZSBXZWIgQXVkaW8gZ3JhcGhcbiAgICAgKiBAcHVibGljXG4gICAgICogQGNoYWluYWJsZVxuICAgICAqIEBwYXJhbSBub2RlIERlc3RpbmF0aW9uIG5vZGVcbiAgICAgKi9cbiAgICBkaXNjb25uZWN0KG5vZGUpIHtcbiAgICAgICAgdGhpcy5tYWluQXVkaW9HcmFwaC5kaXNjb25uZWN0KG5vZGUpO1xuICAgICAgICB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguZGlzY29ubmVjdChub2RlKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7IC8vIEZvciBjaGFpbmFiaWxpdHlcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIFNldCBIUlRGIERhdGFzZXQgdG8gYmUgdXNlZCB3aXRoIHRoZSB2aXJ0dWFsIHNvdXJjZS5cbiAgICAgKiBAcHVibGljXG4gICAgICogQGNoYWluYWJsZVxuICAgICAqIEBwYXJhbSBocnRmRGF0YXNldCBBcnJheSBvZiBPYmplY3RzIGNvbnRhaW5pbmcgdGhlIGF6aW11dGgsIGRpc3RhbmNlLCBlbGV2YXRpb24sIHVybCBhbmQgYnVmZmVyIGZvciBlYWNoIHBvaW50XG4gICAgICovXG4gICAgc2V0IEhSVEZEYXRhc2V0KGhydGZEYXRhc2V0KSB7XG4gICAgICAgIHRoaXMuaHJ0ZkRhdGFzZXQgPSBocnRmRGF0YXNldDtcbiAgICAgICAgdGhpcy5ocnRmRGF0YXNldExlbmd0aCA9IHRoaXMuaHJ0ZkRhdGFzZXQubGVuZ3RoO1xuXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5ocnRmRGF0YXNldExlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgaHJ0ZiA9IHRoaXMuaHJ0ZkRhdGFzZXRbaV07XG4gICAgICAgICAgICAvLyBBemltdXRoIGFuZCBlbGV2YXRpb24gdG8gcmFkaWFuc1xuICAgICAgICAgICAgdmFyIGF6aW11dGhSYWRpYW5zID0gaHJ0Zi5hemltdXRoICogTWF0aC5QSSAvIDE4MDtcbiAgICAgICAgICAgIHZhciBlbGV2YXRpb25SYWRpYW5zID0gaHJ0Zi5lbGV2YXRpb24gKiBNYXRoLlBJIC8gMTgwO1xuICAgICAgICAgICAgdmFyIGNhdGVzaWFuQ29vcmQgPSB0aGlzLnNwaGVyaWNhbFRvQ2FydGVzaWFuKGF6aW11dGhSYWRpYW5zLCBlbGV2YXRpb25SYWRpYW5zLCBocnRmLmRpc3RhbmNlKTtcbiAgICAgICAgICAgIGhydGYueCA9IGNhdGVzaWFuQ29vcmQueDtcbiAgICAgICAgICAgIGhydGYueSA9IGNhdGVzaWFuQ29vcmQueTtcbiAgICAgICAgICAgIGhydGYueiA9IGNhdGVzaWFuQ29vcmQuejtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnRyZWUgPSBrZHQuY3JlYXRlS2RUcmVlKHRoaXMuaHJ0ZkRhdGFzZXQsIHRoaXMuZGlzdGFuY2UsIFsneCcsICd5JywgJ3onXSk7XG5cbiAgICAgICAgLy8gUHV0IGRlZmF1bHQgdmFsdWVzXG4gICAgICAgIHZhciBocnRmTmV4dFBvc2l0aW9uID0gdGhpcy5nZXRIUlRGKDAsIDAsIDEpO1xuICAgICAgICB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguc2V0Q29lZmZpY2llbnRzKGhydGZOZXh0UG9zaXRpb24uaWlyX2NvZWZmc19sZWZ0LCBocnRmTmV4dFBvc2l0aW9uLmlpcl9jb2VmZnNfcmlnaHQpO1xuICAgICAgICB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGguc2V0RGVsYXkoaHJ0Zk5leHRQb3NpdGlvbi5pdGQgLyAxMDAwKTtcbiAgICAgICAgdGhpcy5tYWluQXVkaW9HcmFwaC5zZXRDb2VmZmljaWVudHMoaHJ0Zk5leHRQb3NpdGlvbi5paXJfY29lZmZzX2xlZnQsIGhydGZOZXh0UG9zaXRpb24uaWlyX2NvZWZmc19yaWdodCk7XG4gICAgICAgIHRoaXMubWFpbkF1ZGlvR3JhcGguc2V0RGVsYXkoaHJ0Zk5leHRQb3NpdGlvbi5pdGQgLyAxMDAwKTtcbiAgICB9XG4gICAgZ2V0IEhSVEZEYXRhc2V0KCkge1xuICAgICAgICByZXR1cm4gdGhpcy5ocnRmRGF0YXNldDtcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIENhbGN1bGF0ZSB0aGUgZGlzdGFuY2UgYmV0d2VlbiB0d28gcG9pbnRzIGluIGEgMy1EIHNwYWNlLlxuICAgICAqIEBwcml2YXRlXG4gICAgICogQGNoYWluYWJsZVxuICAgICAqIEBwYXJhbSBhIE9iamVjdCBjb250YWluaW5nIHRocmVlIHByb3BlcnRpZXM6IHgsIHksIHpcbiAgICAgKiBAcGFyYW0gYiBPYmplY3QgY29udGFpbmluZyB0aHJlZSBwcm9wZXJ0aWVzOiB4LCB5LCB6XG4gICAgICovXG4gICAgZGlzdGFuY2UoYSwgYikge1xuICAgICAgICAvLyBObyBuZWVkIHRvIGNvbXB1dGUgc3F1YXJlIHJvb3QgaGVyZSBmb3IgZGlzdGFuY2UgY29tcGFyaXNvbiwgdGhpcyBpcyBtb3JlIGVmaWNpZW50LlxuICAgICAgICByZXR1cm4gTWF0aC5wb3coYS54IC0gYi54LCAyKSArIE1hdGgucG93KGEueSAtIGIueSwgMikgKyBNYXRoLnBvdyhhLnogLSBiLnosIDIpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNldCBnYWluIHZhbHVlIGFuZCBzcXVhcmVkIHZvbHVtZS5cbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqIEBjaGFpbmFibGVcbiAgICAgKiBAdG9kbyA6IHJlYWxtZW50IHZhIGFxdcOtIGFpeMOyP1xuICAgICAqL1xuICAgIHNldExhc3RQb3NpdGlvbigpIHtcbiAgICAgICAgaWYgKCF0aGlzLmlzQ3Jvc3NmYWRpbmcoKSkge1xuICAgICAgICAgICAgdGhpcy5jaGFuZ2VXaGVuRmluaXNoQ3Jvc3NmYWRpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5pbnRlcnZhbElEKTtcbiAgICAgICAgICAgIHRoaXMucmVhbGx5U3RhcnRQb3NpdGlvbigpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3Jvc3NmYWRpbmdcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqIEBjaGFpbmFibGVcbiAgICAgKi9cbiAgICBjcm9zc2ZhZGluZygpIHtcbiAgICAgICAgLy8gRG8gdGhlIGNyb3NzZmFkaW5nIGJldHdlZW4gbWFpbkF1ZGlvR3JhcGggYW5kIHNlY29uZGFyeUF1ZGlvR3JhcGhcbiAgICAgICAgdmFyIG5vdyA9IGF1ZGlvQ29udGV4dC5jdXJyZW50VGltZTtcbiAgICAgICAgLy8gV2FpdCB0d28gYnVmZmVycyB1bnRpbCBkbyB0aGUgY2hhbmdlIChzY3JpcHRQcm9jZXNzb3JOb2RlIG9ubHkgdXBkYXRlIHRoZSB2YXJpYWJsZXMgYXQgdGhlIGZpcnN0IHNhbXBsZSBvZiB0aGUgYnVmZmVyKVxuICAgICAgICB0aGlzLm1haW5BdWRpb0dyYXBoLmdhaW4uc2V0VmFsdWVBdFRpbWUoMSwgbm93ICsgMiAqIHRoaXMuYnVmZmVyU2l6ZSAvIHRoaXMuc2FtcGxlUmF0ZSk7XG4gICAgICAgIHRoaXMubWFpbkF1ZGlvR3JhcGguZ2Fpbi5saW5lYXJSYW1wVG9WYWx1ZUF0VGltZSgwLCBub3cgKyB0aGlzLmNyb3NzZmFkZUR1cmF0aW9uICsgMiAqIHRoaXMuYnVmZmVyU2l6ZSAvIHRoaXMuc2FtcGxlUmF0ZSk7XG5cbiAgICAgICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLmdhaW4uc2V0VmFsdWVBdFRpbWUoMCwgbm93ICsgMiAqIHRoaXMuYnVmZmVyU2l6ZSAvIHRoaXMuc2FtcGxlUmF0ZSk7XG4gICAgICAgIHRoaXMuc2Vjb25kYXJ5QXVkaW9HcmFwaC5nYWluLmxpbmVhclJhbXBUb1ZhbHVlQXRUaW1lKDEsIG5vdyArIHRoaXMuY3Jvc3NmYWRlRHVyYXRpb24gKyAyICogdGhpcy5idWZmZXJTaXplIC8gdGhpcy5zYW1wbGVSYXRlKTtcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIFNldCBwb3NpdGlvbiBvZiB0aGUgdmlydHVhbCBzb3VyY2VcbiAgICAgKiBAcHVibGljXG4gICAgICogQGNoYWluYWJsZVxuICAgICAqIEBwYXJhbSBhemltdXRoIEF6aW11dGggaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gLTE4MCBmb3Igc291cmNlIG9uIHlvdXIgbGVmdCwgYW5kIGZyb20gMCB0byAxODAgZm9yIHNvdXJjZSBvbiB5b3VyIHJpZ2h0XG4gICAgICogQHBhcmFtIGVsZXZhdGlvbiBFbGV2YXRpb24gaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gOTAgZm9yIHNvdXJjZSBhYm92ZSB5b3VyIGhlYWQsIDAgZm9yIHNvdXJjZSBpbiBmcm9udCBvZiB5b3VyIGhlYWQsIGFuZCBmcm9tIDAgdG8gLTkwIGZvciBzb3VyY2UgYmVsb3cgeW91ciBoZWFkKVxuICAgICAqIEBwYXJhbSBkaXN0YW5jZSBEaXN0YW5jZSBpbiBtZXRlcnNcbiAgICAgKi9cbiAgICBzZXRQb3NpdGlvbihhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKSB7XG5cbiAgICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDMpIHtcbiAgICAgICAgICAgIC8vIENhbGN1bGF0ZSB0aGUgbmVhcmVzdCBwb3NpdGlvbiBmb3IgdGhlIGlucHV0IGF6aW11dGgsIGVsZXZhdGlvbiBhbmQgZGlzdGFuY2VcbiAgICAgICAgICAgIHZhciBuZWFyZXN0UG9zaXRpb24gPSB0aGlzLmdldFJlYWxDb29yZGluYXRlcyhhemltdXRoLCBlbGV2YXRpb24sIGRpc3RhbmNlKTtcbiAgICAgICAgICAgIC8vIE5vIG5lZWQgdG8gY2hhbmdlIHRoZSBjdXJyZW50IEhSVEYgbG9hZGVkIGlmIHNldHRlZCBwb3NpdGlvbiBlcXVhbCBjdXJyZW50IHBvc2l0aW9uXG4gICAgICAgICAgICBpZiAobmVhcmVzdFBvc2l0aW9uLmF6aW11dGggIT09IHRoaXMucG9zaXRpb24uYXppbXV0aCB8fCBuZWFyZXN0UG9zaXRpb24uZWxldmF0aW9uICE9PSB0aGlzLnBvc2l0aW9uLmVsZXZhdGlvbiB8fCBuZWFyZXN0UG9zaXRpb24uZGlzdGFuY2UgIT09IHRoaXMucG9zaXRpb24uZGlzdGFuY2UpIHtcbiAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiB0aGUgY3Jvc3NmYWRpbmcgaXMgYWN0aXZlXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuaXNDcm9zc2ZhZGluZygpID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoZXJlIGlzIGEgdmFsdWUgd2FpdGluZyB0byBiZSBzZXRcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuY2hhbmdlV2hlbkZpbmlzaENyb3NzZmFkaW5nID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBTdG9wIHRoZSBwYXN0IHNldEludGVydmFsIGV2ZW50LlxuICAgICAgICAgICAgICAgICAgICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLmludGVydmFsSUQpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5jaGFuZ2VXaGVuRmluaXNoQ3Jvc3NmYWRpbmcgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gU2F2ZSB0aGUgcG9zaXRpb25cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5uZXh0UG9zaXRpb24uYXppbXV0aCA9IG5lYXJlc3RQb3NpdGlvbi5hemltdXRoO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm5leHRQb3NpdGlvbi5lbGV2YXRpb24gPSBuZWFyZXN0UG9zaXRpb24uZWxldmF0aW9uO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm5leHRQb3NpdGlvbi5kaXN0YW5jZSA9IG5lYXJlc3RQb3NpdGlvbi5kaXN0YW5jZTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBTdGFydCB0aGUgc2V0SW50ZXJ2YWw6IHdhaXQgdW50aWwgdGhlIGNyb3NzZmFkaW5nIGlzIGZpbmlzaGVkLlxuICAgICAgICAgICAgICAgICAgICB0aGlzLmludGVydmFsSUQgPSB3aW5kb3cuc2V0SW50ZXJ2YWwodGhpcy5zZXRMYXN0UG9zaXRpb24uYmluZCh0aGlzKSwgMC4wMDUpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubmV4dFBvc2l0aW9uLmF6aW11dGggPSBuZWFyZXN0UG9zaXRpb24uYXppbXV0aDtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5uZXh0UG9zaXRpb24uZWxldmF0aW9uID0gbmVhcmVzdFBvc2l0aW9uLmVsZXZhdGlvbjtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5uZXh0UG9zaXRpb24uZGlzdGFuY2UgPSBuZWFyZXN0UG9zaXRpb24uZGlzdGFuY2U7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVhbGx5U3RhcnRQb3NpdGlvbigpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpczsgLy8gRm9yIGNoYWluYWJpbGl0eVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBSZWFsbHkgY2hhbmdlIHRoZSBwb3NpdGlvblxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgcmVhbGx5U3RhcnRQb3NpdGlvbigpIHtcbiAgICAgICAgLy8gU2F2ZSB0aGUgY3VycmVudCBwb3NpdGlvblxuICAgICAgICB0aGlzLnBvc2l0aW9uLmF6aW11dGggPSB0aGlzLm5leHRQb3NpdGlvbi5hemltdXRoO1xuICAgICAgICB0aGlzLnBvc2l0aW9uLmVsZXZhdGlvbiA9IHRoaXMubmV4dFBvc2l0aW9uLmVsZXZhdGlvbjtcbiAgICAgICAgdGhpcy5wb3NpdGlvbi5kaXN0YW5jZSA9IHRoaXMubmV4dFBvc2l0aW9uLmRpc3RhbmNlO1xuXG4gICAgICAgIHZhciBocnRmTmV4dFBvc2l0aW9uID0gdGhpcy5nZXRIUlRGKHRoaXMucG9zaXRpb24uYXppbXV0aCwgdGhpcy5wb3NpdGlvbi5lbGV2YXRpb24sIHRoaXMucG9zaXRpb24uZGlzdGFuY2UpO1xuICAgICAgICAvLyBMb2FkIHRoZSBuZXcgcG9zaXRpb24gaW4gdGhlIGJpcXVhZCBhbmQgZGVsYXkgbm90IGFjdGl2ZSAoc2Vjb25kYXJ5QXVkaW9HcmFwaClcbiAgICAgICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLnNldENvZWZmaWNpZW50cyhocnRmTmV4dFBvc2l0aW9uLmlpcl9jb2VmZnNfbGVmdCwgaHJ0Zk5leHRQb3NpdGlvbi5paXJfY29lZmZzX3JpZ2h0KTtcbiAgICAgICAgdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoLnNldERlbGF5KGhydGZOZXh0UG9zaXRpb24uaXRkIC8gMTAwMCk7XG5cbiAgICAgICAgLy8gRG8gdGhlIGNyb3NzZmFkaW5nIGJldHdlZW4gbWFpbkF1ZGlvR3JhcGggYW5kIHNlY29uZGFyeUF1ZGlvR3JhcGhcbiAgICAgICAgdGhpcy5jcm9zc2ZhZGluZygpO1xuXG4gICAgICAgIC8vIENoYW5nZSBjdXJyZW50IG1haW5BdWRpb0dyYXBoXG4gICAgICAgIHZhciBhY3RpdmUgPSB0aGlzLm1haW5BdWRpb0dyYXBoO1xuICAgICAgICB0aGlzLm1haW5BdWRpb0dyYXBoID0gdGhpcy5zZWNvbmRhcnlBdWRpb0dyYXBoO1xuICAgICAgICB0aGlzLnNlY29uZGFyeUF1ZGlvR3JhcGggPSBhY3RpdmU7XG5cbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgY3VycmVudCBwb3NpdGlvbiBvZiB0aGUgdmlydHVhbCBzb3VyY2UuXG4gICAgICogQHB1YmxpY1xuICAgICAqL1xuICAgIGdldFBvc2l0aW9uKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5wb3NpdGlvbjtcbiAgICB9XG5cblxuICAgIC8qKlxuICAgICAqIFBhdXNlIHBsYXlpbmcuXG4gICAgICogQHB1YmxpY1xuICAgICAqL1xuICAgIHNldENyb3NzZmFkZUR1cmF0aW9uKG1zUmFtcCkge1xuICAgICAgICAvL3NhdmUgaW4gc2Vjb25kc1xuICAgICAgICB0aGlzLmNyb3NzZmFkZUR1cmF0aW9uID0gbXNSYW1wIC8gMTAwMDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTZWVrIGJ1ZmZlciBwb3NpdGlvbiAoaW4gc2VjKS5cbiAgICAgKiBAcHVibGljXG4gICAgICovXG4gICAgZ2V0Q3Jvc3NmYWRlRHVyYXRpb24oKSB7XG4gICAgICAgIC8vcmV0dXJuIGluIG1zXG4gICAgICAgIHJldHVybiBjcm9zc2ZhZGVEdXJhdGlvbiAqIDEwMDA7XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBSZWxlYXNlIHBsYXlpbmcgZmxhZyB3aGVuIHRoZSBlbmQgb2YgdGhlIGJ1ZmZlciBpcyByZWFjaGVkLlxuICAgICAqIEBwdWJsaWNcbiAgICAgKiBAdG9kbyBIYW5kbGUgc3BlZWQgY2hhbmdlcy5cbiAgICAgKi9cbiAgICBpc0Nyb3NzZmFkaW5nKCkge1xuICAgICAgICAvLyBUaGUgcmFtcHMgYXJlIG5vdCBmaW5pc2hlZCwgc28gdGhlIGNyb3NzZmFkaW5nIGlzIG5vdCBmaW5pc2hlZFxuICAgICAgICBpZiAodGhpcy5tYWluQXVkaW9HcmFwaC5nYWluLnZhbHVlICE9PSAxKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBIUlRGIGZpbGUgZm9yIGFuIGVzcGVjaWZpYyBwb3NpdGlvblxuICAgICAqIEBwcml2YXRlXG4gICAgICogQHBhcmFtIGF6aW11dGggQXppbXV0aCBpbiBkZWdyZWVzICjCsCk6IGZyb20gMCB0byAtMTgwIGZvciBzb3VyY2Ugb24geW91ciBsZWZ0LCBhbmQgZnJvbSAwIHRvIDE4MCBmb3Igc291cmNlIG9uIHlvdXIgcmlnaHRcbiAgICAgKiBAcGFyYW0gZWxldmF0aW9uIEVsZXZhdGlvbiBpbiBkZWdyZWVzICjCsCk6IGZyb20gMCB0byA5MCBmb3Igc291cmNlIGFib3ZlIHlvdXIgaGVhZCwgMCBmb3Igc291cmNlIGluIGZyb250IG9mIHlvdXIgaGVhZCwgYW5kIGZyb20gMCB0byAtOTAgZm9yIHNvdXJjZSBiZWxvdyB5b3VyIGhlYWQpXG4gICAgICogQHBhcmFtIGRpc3RhbmNlIERpc3RhbmNlIGluIG1ldGVyc1xuICAgICAqL1xuICAgIGdldEhSVEYoYXppbXV0aCwgZWxldmF0aW9uLCBkaXN0YW5jZSkge1xuICAgICAgICB2YXIgbmVhcmVzdCA9IHRoaXMuZ2V0TmVhcmVzdFBvaW50KGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpO1xuICAgICAgICB2YXIgaHJ0ZiA9IFtdO1xuICAgICAgICBocnRmLmlpcl9jb2VmZnNfbGVmdCA9IG5lYXJlc3QuaWlyX2NvZWZmc19sZWZ0O1xuICAgICAgICBocnRmLmlpcl9jb2VmZnNfcmlnaHQgPSBuZWFyZXN0Lmlpcl9jb2VmZnNfcmlnaHQ7XG4gICAgICAgIGhydGYuaXRkID0gbmVhcmVzdC5pdGQ7XG5cbiAgICAgICAgLy8gUmV0dXJuIGhydGYgZGF0YSBvZiBuZWFyZXN0IHBvc2l0aW9uIGZvciB0aGUgaW5wdXQgdmFsdWVzXG4gICAgICAgIHJldHVybiBocnRmO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFRyYW5zZm9ybSB0aGUgc3BoZXJpY2FsIHRvIGNhcnRlc2lhbiBjb29yZGluYXRlcy5cbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqIEBwYXJhbSBhemltdXRoIEF6aW11dGggaW4gcmFkaWFuc1xuICAgICAqIEBwYXJhbSBlbGV2YXRpb24gRWxldmF0aW9uIGluIHJhZGlhbnNcbiAgICAgKiBAcGFyYW0gZGlzdGFuY2UgRGlzdGFuY2UgaW4gbWV0ZXJzXG4gICAgICovXG4gICAgc3BoZXJpY2FsVG9DYXJ0ZXNpYW4oYXppbXV0aCwgZWxldmF0aW9uLCBkaXN0YW5jZSkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgeDogZGlzdGFuY2UgKiBNYXRoLnNpbihhemltdXRoKSxcbiAgICAgICAgICAgIHk6IGRpc3RhbmNlICogTWF0aC5jb3MoYXppbXV0aCksXG4gICAgICAgICAgICB6OiBkaXN0YW5jZSAqIE1hdGguc2luKGVsZXZhdGlvbilcbiAgICAgICAgfVxuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogR2V0IHRoZSBuZWFyZXN0IHBvc2l0aW9uIGZvciBhbiBpbnB1dCBwb3NpdGlvbi5cbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqIEBwYXJhbSBhemltdXRoIEF6aW11dGggaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gLTE4MCBmb3Igc291cmNlIG9uIHlvdXIgbGVmdCwgYW5kIGZyb20gMCB0byAxODAgZm9yIHNvdXJjZSBvbiB5b3VyIHJpZ2h0XG4gICAgICogQHBhcmFtIGVsZXZhdGlvbiBFbGV2YXRpb24gaW4gZGVncmVlcyAowrApOiBmcm9tIDAgdG8gOTAgZm9yIHNvdXJjZSBhYm92ZSB5b3VyIGhlYWQsIDAgZm9yIHNvdXJjZSBpbiBmcm9udCBvZiB5b3VyIGhlYWQsIGFuZCBmcm9tIDAgdG8gLTkwIGZvciBzb3VyY2UgYmVsb3cgeW91ciBoZWFkKVxuICAgICAqIEBwYXJhbSBkaXN0YW5jZSBEaXN0YW5jZSBpbiBtZXRlcnNcbiAgICAgKi9cbiAgICBnZXRSZWFsQ29vcmRpbmF0ZXMoYXppbXV0aCwgZWxldmF0aW9uLCBkaXN0YW5jZSkge1xuICAgICAgICB2YXIgbmVhcmVzdCA9IHRoaXMuZ2V0TmVhcmVzdFBvaW50KGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpO1xuICAgICAgICAvLyBSZXR1cm4gYXppbXV0aCwgZWxldmF0aW9uIGFuZCBkaXN0YW5jZSBvZiBuZWFyZXN0IHBvc2l0aW9uIGZvciB0aGUgaW5wdXQgdmFsdWVzXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBhemltdXRoOiBuZWFyZXN0LmF6aW11dGgsXG4gICAgICAgICAgICBlbGV2YXRpb246IG5lYXJlc3QuZWxldmF0aW9uLFxuICAgICAgICAgICAgZGlzdGFuY2U6IG5lYXJlc3QuZGlzdGFuY2VcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCB0aGUgbmVhcmVzdCBwb3NpdGlvbiBmb3IgYW4gaW5wdXQgcG9zaXRpb24uXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAcGFyYW0gYXppbXV0aCBBemltdXRoIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIC0xODAgZm9yIHNvdXJjZSBvbiB5b3VyIGxlZnQsIGFuZCBmcm9tIDAgdG8gMTgwIGZvciBzb3VyY2Ugb24geW91ciByaWdodFxuICAgICAqIEBwYXJhbSBlbGV2YXRpb24gRWxldmF0aW9uIGluIGRlZ3JlZXMgKMKwKTogZnJvbSAwIHRvIDkwIGZvciBzb3VyY2UgYWJvdmUgeW91ciBoZWFkLCAwIGZvciBzb3VyY2UgaW4gZnJvbnQgb2YgeW91ciBoZWFkLCBhbmQgZnJvbSAwIHRvIC05MCBmb3Igc291cmNlIGJlbG93IHlvdXIgaGVhZClcbiAgICAgKiBAcGFyYW0gZGlzdGFuY2UgRGlzdGFuY2UgaW4gbWV0ZXJzXG4gICAgICovXG4gICAgZ2V0TmVhcmVzdFBvaW50KGF6aW11dGgsIGVsZXZhdGlvbiwgZGlzdGFuY2UpIHtcbiAgICAgICAgLy8gRGVncmVlcyB0byByYWRpYW5zIGZvciB0aGUgYXppbXV0aCBhbmQgZWxldmF0aW9uXG4gICAgICAgIHZhciBhemltdXRoUmFkaWFucyA9IGF6aW11dGggKiBNYXRoLlBJIC8gMTgwO1xuICAgICAgICB2YXIgZWxldmF0aW9uUmFkaWFucyA9IGVsZXZhdGlvbiAqIE1hdGguUEkgLyAxODA7XG4gICAgICAgIC8vIENvbnZlcnQgc3BoZXJpY2FsIGNvb3JkaW5hdGVzIHRvIGNhcnRlc2lhblxuICAgICAgICB2YXIgY2FydGVzaWFuQ29vcmQgPSB0aGlzLnNwaGVyaWNhbFRvQ2FydGVzaWFuKGF6aW11dGhSYWRpYW5zLCBlbGV2YXRpb25SYWRpYW5zLCBkaXN0YW5jZSk7XG4gICAgICAgIC8vIEdldCB0aGUgbmVhcmVzdCBIUlRGIGZpbGUgZm9yIHRoZSBkZXNpcmVkIHBvc2l0aW9uXG4gICAgICAgIHZhciBuZWFyZXN0ID0gdGhpcy50cmVlLm5lYXJlc3QoY2FydGVzaWFuQ29vcmQsIDEpWzBdO1xuXG4gICAgICAgIHJldHVybiBuZWFyZXN0WzBdO1xuICAgIH1cblxuXG59O1xuXG4vKipcbiAqIEF1ZGlvR3JhcGggc3ViIGF1ZGlvIGdyYXBoIG9iamVjdCBhcyBhbiBFQ01BU2NyaXB0NSBwcm9wZXJ0aWVzIG9iamVjdC5cbiAqL1xuXG5jbGFzcyBQcm9jZXNzaW5nQXVkaW9HcmFwaCB7XG5cblxuICAgIGNvbnN0cnVjdG9yKCkge1xuICAgICAgICAvLyBQcml2YXRlIHByb3BlcnRpZXNcbiAgICAgICAgdGhpcy5idWZmZXJTaXplID0gMTAyNDtcblxuICAgICAgICAvLyBDcmVhdGlvbnNcbiAgICAgICAgdGhpcy5pbnB1dCA9IGF1ZGlvQ29udGV4dC5jcmVhdGVHYWluKCk7XG4gICAgICAgIHRoaXMuZ2Fpbk5vZGUgPSBhdWRpb0NvbnRleHQuY3JlYXRlR2FpbigpO1xuICAgICAgICB0aGlzLmJpcXVhZEZpbHRlckxlZnQgPSBuZXcgQmlxdWFkRmlsdGVyKCk7XG4gICAgICAgIHRoaXMuYmlxdWFkRmlsdGVyUmlnaHQgPSBuZXcgQmlxdWFkRmlsdGVyKCk7XG4gICAgICAgIHRoaXMuZnJhY3Rpb25hbERlbGF5TGVmdCA9IG5ldyBGcmFjdGlvbmFsRGVsYXkoNDQxMDApO1xuICAgICAgICB0aGlzLmZyYWN0aW9uYWxEZWxheVJpZ2h0ID0gbmV3IEZyYWN0aW9uYWxEZWxheSg0NDEwMCk7XG4gICAgICAgIHRoaXMucHJvY2Vzc29yTm9kZSA9IGF1ZGlvQ29udGV4dC5jcmVhdGVTY3JpcHRQcm9jZXNzb3IodGhpcy5idWZmZXJTaXplKTtcbiAgICAgICAgLy8gQ29ubmVjdGlvbnNcbiAgICAgICAgdGhpcy5pbnB1dC5jb25uZWN0KHRoaXMucHJvY2Vzc29yTm9kZSk7XG4gICAgICAgIHRoaXMucHJvY2Vzc29yTm9kZS5jb25uZWN0KHRoaXMuZ2Fpbk5vZGUpO1xuICAgICAgICAvLyBTdGFydCBwcm9jZXNzb3JOb2RlXG4gICAgICAgIHRoaXMucHJvY2Vzc29yTm9kZUZ1bmN0aW9uKCk7XG4gICAgfVxuXG4gICAgZ2V0IGdhaW4oKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdhaW5Ob2RlLmdhaW47XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2V0IGNvZWZmaWNpZW50cyBiaXF1YWQgZmlsdGVyXG4gICAgICogQHB1YmxpY1xuICAgICAqIEBwYXJhbSB2YWx1ZSBBdWRpb0J1ZmZlciBPYmplY3QuXG4gICAgICovXG4gICAgc2V0Q29lZmZpY2llbnRzKGxlZnRDb2VmZmljaWVudHMsIHJpZ2h0Q29lZmZpY2llbnRzKSB7XG4gICAgICAgIHRoaXMuYmlxdWFkRmlsdGVyTGVmdC5zZXRDb2VmZmljaWVudHMobGVmdENvZWZmaWNpZW50cyk7XG4gICAgICAgIHRoaXMuYmlxdWFkRmlsdGVyUmlnaHQuc2V0Q29lZmZpY2llbnRzKHJpZ2h0Q29lZmZpY2llbnRzKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTZXQgYnVmZmVyIGFuZCBidWZmZXJEdXJhdGlvbi5cbiAgICAgKiBAcHVibGljXG4gICAgICogQGNoYWluYWJsZVxuICAgICAqL1xuICAgIHNldERlbGF5KGRlbGF5KSB7XG4gICAgICAgIHZhciBkZWxheUxlZnQgPSAxIC8gMTAwMCArIGRlbGF5IC8gMjtcbiAgICAgICAgdmFyIGRlbGF5UmlnaHQgPSAxIC8gMTAwMCAtIGRlbGF5IC8gMjtcbiAgICAgICAgdGhpcy5mcmFjdGlvbmFsRGVsYXlMZWZ0LnNldERlbGF5KGRlbGF5TGVmdCk7XG4gICAgICAgIHRoaXMuZnJhY3Rpb25hbERlbGF5UmlnaHQuc2V0RGVsYXkoZGVsYXlSaWdodCk7XG4gICAgfVxuXG5cbiAgICBwcm9jZXNzb3JOb2RlRnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciB0aGF0ID0gdGhpcztcbiAgICAgICAgdGhpcy5wcm9jZXNzb3JOb2RlLm9uYXVkaW9wcm9jZXNzID0gZnVuY3Rpb24oZSkge1xuICAgICAgICAgICAgLy8gR2V0IHRoZSBpbnB1dEJ1ZmZlclxuICAgICAgICAgICAgdmFyIGlucHV0QXJyYXkgPSBlLmlucHV0QnVmZmVyLmdldENoYW5uZWxEYXRhKDApO1xuXG4gICAgICAgICAgICAvLyBHZXQgdGhlIG91dHB1dEJ1ZmZlcnNcbiAgICAgICAgICAgIHZhciBsZWZ0T3V0cHV0QXJyYXkgPSBlLm91dHB1dEJ1ZmZlci5nZXRDaGFubmVsRGF0YSgwKTtcbiAgICAgICAgICAgIHZhciByaWdodE91dHB1dEFycmF5ID0gZS5vdXRwdXRCdWZmZXIuZ2V0Q2hhbm5lbERhdGEoMSk7XG5cbiAgICAgICAgICAgIC8vIERlbGF5XG4gICAgICAgICAgICB2YXIgbWVkaXVtQXJyYXlMZWZ0ID0gbmV3IEZsb2F0MzJBcnJheSh0aGF0LmZyYWN0aW9uYWxEZWxheUxlZnQucHJvY2VzcyhpbnB1dEFycmF5KSk7XG4gICAgICAgICAgICB2YXIgbWVkaXVtQXJyYXlSaWdodCA9IG5ldyBGbG9hdDMyQXJyYXkodGhhdC5mcmFjdGlvbmFsRGVsYXlSaWdodC5wcm9jZXNzKGlucHV0QXJyYXkpKTtcblxuICAgICAgICAgICAgLy8gQmlxdWFkRmlsdGVyXG4gICAgICAgICAgICB0aGF0LmJpcXVhZEZpbHRlckxlZnQucHJvY2VzcyhtZWRpdW1BcnJheUxlZnQsIGxlZnRPdXRwdXRBcnJheSk7XG4gICAgICAgICAgICB0aGF0LmJpcXVhZEZpbHRlclJpZ2h0LnByb2Nlc3MobWVkaXVtQXJyYXlSaWdodCwgcmlnaHRPdXRwdXRBcnJheSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDb25uZWN0IHRoZSBjb252b2x2ZXJBdWRpb0dyYXBoIHRvIGEgbm9kZVxuICAgICAqIEBwdWJsaWNcbiAgICAgKiBAY2hhaW5hYmxlXG4gICAgICogQHBhcmFtIG5vZGUgRGVzdGluYXRpb24gbm9kZVxuICAgICAqL1xuICAgIGNvbm5lY3Qobm9kZSkge1xuICAgICAgICB0aGlzLmdhaW5Ob2RlLmNvbm5lY3Qobm9kZSk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERpc2Nvbm5lY3QgdGhlIGNvbnZvbHZlckF1ZGlvR3JhcGggdG8gYSBub2RlXG4gICAgICogQHB1YmxpY1xuICAgICAqIEBjaGFpbmFibGVcbiAgICAgKiBAcGFyYW0gbm9kZSBEZXN0aW5hdGlvbiBub2RlXG4gICAgICovXG4gICAgZGlzY29ubmVjdChub2RlKSB7XG4gICAgICAgIHRoaXMuZ2Fpbk5vZGUuZGlzY29ubmVjdChub2RlKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG5cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBCaW5hdXJhbE1vZGVsZWQ7XG4iLCIvKiBDb3B5cmlnaHQgMjAxMyBDaHJpcyBXaWxzb25cblxuICAgTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAgIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAgIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuXG4gICAgICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG5cbiAgIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAgIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAgIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICAgU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICAgbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4qL1xuXG4vKiBcblxuVGhpcyBtb25rZXlwYXRjaCBsaWJyYXJ5IGlzIGludGVuZGVkIHRvIGJlIGluY2x1ZGVkIGluIHByb2plY3RzIHRoYXQgYXJlXG53cml0dGVuIHRvIHRoZSBwcm9wZXIgQXVkaW9Db250ZXh0IHNwZWMgKGluc3RlYWQgb2Ygd2Via2l0QXVkaW9Db250ZXh0KSwgXG5hbmQgdGhhdCB1c2UgdGhlIG5ldyBuYW1pbmcgYW5kIHByb3BlciBiaXRzIG9mIHRoZSBXZWIgQXVkaW8gQVBJIChlLmcuIFxudXNpbmcgQnVmZmVyU291cmNlTm9kZS5zdGFydCgpIGluc3RlYWQgb2YgQnVmZmVyU291cmNlTm9kZS5ub3RlT24oKSksIGJ1dCBtYXlcbmhhdmUgdG8gcnVuIG9uIHN5c3RlbXMgdGhhdCBvbmx5IHN1cHBvcnQgdGhlIGRlcHJlY2F0ZWQgYml0cy5cblxuVGhpcyBsaWJyYXJ5IHNob3VsZCBiZSBoYXJtbGVzcyB0byBpbmNsdWRlIGlmIHRoZSBicm93c2VyIHN1cHBvcnRzIFxudW5wcmVmaXhlZCBcIkF1ZGlvQ29udGV4dFwiLCBhbmQvb3IgaWYgaXQgc3VwcG9ydHMgdGhlIG5ldyBuYW1lcy4gIFxuXG5UaGUgcGF0Y2hlcyB0aGlzIGxpYnJhcnkgaGFuZGxlczpcbmlmIHdpbmRvdy5BdWRpb0NvbnRleHQgaXMgdW5zdXBwb3J0ZWQsIGl0IHdpbGwgYmUgYWxpYXNlZCB0byB3ZWJraXRBdWRpb0NvbnRleHQoKS5cbmlmIEF1ZGlvQnVmZmVyU291cmNlTm9kZS5zdGFydCgpIGlzIHVuaW1wbGVtZW50ZWQsIGl0IHdpbGwgYmUgcm91dGVkIHRvIG5vdGVPbigpIG9yXG5ub3RlR3JhaW5PbigpLCBkZXBlbmRpbmcgb24gcGFyYW1ldGVycy5cblxuVGhlIGZvbGxvd2luZyBhbGlhc2VzIG9ubHkgdGFrZSBlZmZlY3QgaWYgdGhlIG5ldyBuYW1lcyBhcmUgbm90IGFscmVhZHkgaW4gcGxhY2U6XG5cbkF1ZGlvQnVmZmVyU291cmNlTm9kZS5zdG9wKCkgaXMgYWxpYXNlZCB0byBub3RlT2ZmKClcbkF1ZGlvQ29udGV4dC5jcmVhdGVHYWluKCkgaXMgYWxpYXNlZCB0byBjcmVhdGVHYWluTm9kZSgpXG5BdWRpb0NvbnRleHQuY3JlYXRlRGVsYXkoKSBpcyBhbGlhc2VkIHRvIGNyZWF0ZURlbGF5Tm9kZSgpXG5BdWRpb0NvbnRleHQuY3JlYXRlU2NyaXB0UHJvY2Vzc29yKCkgaXMgYWxpYXNlZCB0byBjcmVhdGVKYXZhU2NyaXB0Tm9kZSgpXG5BdWRpb0NvbnRleHQuY3JlYXRlUGVyaW9kaWNXYXZlKCkgaXMgYWxpYXNlZCB0byBjcmVhdGVXYXZlVGFibGUoKVxuT3NjaWxsYXRvck5vZGUuc3RhcnQoKSBpcyBhbGlhc2VkIHRvIG5vdGVPbigpXG5Pc2NpbGxhdG9yTm9kZS5zdG9wKCkgaXMgYWxpYXNlZCB0byBub3RlT2ZmKClcbk9zY2lsbGF0b3JOb2RlLnNldFBlcmlvZGljV2F2ZSgpIGlzIGFsaWFzZWQgdG8gc2V0V2F2ZVRhYmxlKClcbkF1ZGlvUGFyYW0uc2V0VGFyZ2V0QXRUaW1lKCkgaXMgYWxpYXNlZCB0byBzZXRUYXJnZXRWYWx1ZUF0VGltZSgpXG5cblRoaXMgbGlicmFyeSBkb2VzIE5PVCBwYXRjaCB0aGUgZW51bWVyYXRlZCB0eXBlIGNoYW5nZXMsIGFzIGl0IGlzIFxucmVjb21tZW5kZWQgaW4gdGhlIHNwZWNpZmljYXRpb24gdGhhdCBpbXBsZW1lbnRhdGlvbnMgc3VwcG9ydCBib3RoIGludGVnZXJcbmFuZCBzdHJpbmcgdHlwZXMgZm9yIEF1ZGlvUGFubmVyTm9kZS5wYW5uaW5nTW9kZWwsIEF1ZGlvUGFubmVyTm9kZS5kaXN0YW5jZU1vZGVsIFxuQmlxdWFkRmlsdGVyTm9kZS50eXBlIGFuZCBPc2NpbGxhdG9yTm9kZS50eXBlLlxuXG4qL1xuKGZ1bmN0aW9uIChnbG9iYWwsIGV4cG9ydHMsIHBlcmYpIHtcbiAgJ3VzZSBzdHJpY3QnO1xuXG4gIGZ1bmN0aW9uIGZpeFNldFRhcmdldChwYXJhbSkge1xuICAgIGlmICghcGFyYW0pIC8vIGlmIE5ZSSwganVzdCByZXR1cm5cbiAgICAgIHJldHVybjtcbiAgICBpZiAoIXBhcmFtLnNldFRhcmdldEF0VGltZSlcbiAgICAgIHBhcmFtLnNldFRhcmdldEF0VGltZSA9IHBhcmFtLnNldFRhcmdldFZhbHVlQXRUaW1lOyBcbiAgfVxuXG4gIGlmICh3aW5kb3cuaGFzT3duUHJvcGVydHkoJ3dlYmtpdEF1ZGlvQ29udGV4dCcpICYmIFxuICAgICAgIXdpbmRvdy5oYXNPd25Qcm9wZXJ0eSgnQXVkaW9Db250ZXh0JykpIHtcbiAgICB3aW5kb3cuQXVkaW9Db250ZXh0ID0gd2Via2l0QXVkaW9Db250ZXh0O1xuXG4gICAgaWYgKCFBdWRpb0NvbnRleHQucHJvdG90eXBlLmhhc093blByb3BlcnR5KCdjcmVhdGVHYWluJykpXG4gICAgICBBdWRpb0NvbnRleHQucHJvdG90eXBlLmNyZWF0ZUdhaW4gPSBBdWRpb0NvbnRleHQucHJvdG90eXBlLmNyZWF0ZUdhaW5Ob2RlO1xuICAgIGlmICghQXVkaW9Db250ZXh0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eSgnY3JlYXRlRGVsYXknKSlcbiAgICAgIEF1ZGlvQ29udGV4dC5wcm90b3R5cGUuY3JlYXRlRGVsYXkgPSBBdWRpb0NvbnRleHQucHJvdG90eXBlLmNyZWF0ZURlbGF5Tm9kZTtcbiAgICBpZiAoIUF1ZGlvQ29udGV4dC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkoJ2NyZWF0ZVNjcmlwdFByb2Nlc3NvcicpKVxuICAgICAgQXVkaW9Db250ZXh0LnByb3RvdHlwZS5jcmVhdGVTY3JpcHRQcm9jZXNzb3IgPSBBdWRpb0NvbnRleHQucHJvdG90eXBlLmNyZWF0ZUphdmFTY3JpcHROb2RlO1xuICAgIGlmICghQXVkaW9Db250ZXh0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eSgnY3JlYXRlUGVyaW9kaWNXYXZlJykpXG4gICAgICBBdWRpb0NvbnRleHQucHJvdG90eXBlLmNyZWF0ZVBlcmlvZGljV2F2ZSA9IEF1ZGlvQ29udGV4dC5wcm90b3R5cGUuY3JlYXRlV2F2ZVRhYmxlO1xuXG5cbiAgICBBdWRpb0NvbnRleHQucHJvdG90eXBlLmludGVybmFsX2NyZWF0ZUdhaW4gPSBBdWRpb0NvbnRleHQucHJvdG90eXBlLmNyZWF0ZUdhaW47XG4gICAgQXVkaW9Db250ZXh0LnByb3RvdHlwZS5jcmVhdGVHYWluID0gZnVuY3Rpb24oKSB7IFxuICAgICAgdmFyIG5vZGUgPSB0aGlzLmludGVybmFsX2NyZWF0ZUdhaW4oKTtcbiAgICAgIGZpeFNldFRhcmdldChub2RlLmdhaW4pO1xuICAgICAgcmV0dXJuIG5vZGU7XG4gICAgfTtcblxuICAgIEF1ZGlvQ29udGV4dC5wcm90b3R5cGUuaW50ZXJuYWxfY3JlYXRlRGVsYXkgPSBBdWRpb0NvbnRleHQucHJvdG90eXBlLmNyZWF0ZURlbGF5O1xuICAgIEF1ZGlvQ29udGV4dC5wcm90b3R5cGUuY3JlYXRlRGVsYXkgPSBmdW5jdGlvbihtYXhEZWxheVRpbWUpIHsgXG4gICAgICB2YXIgbm9kZSA9IG1heERlbGF5VGltZSA/IHRoaXMuaW50ZXJuYWxfY3JlYXRlRGVsYXkobWF4RGVsYXlUaW1lKSA6IHRoaXMuaW50ZXJuYWxfY3JlYXRlRGVsYXkoKTtcbiAgICAgIGZpeFNldFRhcmdldChub2RlLmRlbGF5VGltZSk7XG4gICAgICByZXR1cm4gbm9kZTtcbiAgICB9O1xuXG4gICAgQXVkaW9Db250ZXh0LnByb3RvdHlwZS5pbnRlcm5hbF9jcmVhdGVCdWZmZXJTb3VyY2UgPSBBdWRpb0NvbnRleHQucHJvdG90eXBlLmNyZWF0ZUJ1ZmZlclNvdXJjZTtcbiAgICBBdWRpb0NvbnRleHQucHJvdG90eXBlLmNyZWF0ZUJ1ZmZlclNvdXJjZSA9IGZ1bmN0aW9uKCkgeyBcbiAgICAgIHZhciBub2RlID0gdGhpcy5pbnRlcm5hbF9jcmVhdGVCdWZmZXJTb3VyY2UoKTtcbiAgICAgIGlmICghbm9kZS5zdGFydCkge1xuICAgICAgICBub2RlLnN0YXJ0ID0gZnVuY3Rpb24gKCB3aGVuLCBvZmZzZXQsIGR1cmF0aW9uICkge1xuICAgICAgICAgIGlmICggb2Zmc2V0IHx8IGR1cmF0aW9uIClcbiAgICAgICAgICAgIHRoaXMubm90ZUdyYWluT24oIHdoZW4sIG9mZnNldCwgZHVyYXRpb24gKTtcbiAgICAgICAgICBlbHNlXG4gICAgICAgICAgICB0aGlzLm5vdGVPbiggd2hlbiApO1xuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgaWYgKCFub2RlLnN0b3ApXG4gICAgICAgIG5vZGUuc3RvcCA9IG5vZGUubm90ZU9mZjtcbiAgICAgIGZpeFNldFRhcmdldChub2RlLnBsYXliYWNrUmF0ZSk7XG4gICAgICByZXR1cm4gbm9kZTtcbiAgICB9O1xuXG4gICAgQXVkaW9Db250ZXh0LnByb3RvdHlwZS5pbnRlcm5hbF9jcmVhdGVEeW5hbWljc0NvbXByZXNzb3IgPSBBdWRpb0NvbnRleHQucHJvdG90eXBlLmNyZWF0ZUR5bmFtaWNzQ29tcHJlc3NvcjtcbiAgICBBdWRpb0NvbnRleHQucHJvdG90eXBlLmNyZWF0ZUR5bmFtaWNzQ29tcHJlc3NvciA9IGZ1bmN0aW9uKCkgeyBcbiAgICAgIHZhciBub2RlID0gdGhpcy5pbnRlcm5hbF9jcmVhdGVEeW5hbWljc0NvbXByZXNzb3IoKTtcbiAgICAgIGZpeFNldFRhcmdldChub2RlLnRocmVzaG9sZCk7XG4gICAgICBmaXhTZXRUYXJnZXQobm9kZS5rbmVlKTtcbiAgICAgIGZpeFNldFRhcmdldChub2RlLnJhdGlvKTtcbiAgICAgIGZpeFNldFRhcmdldChub2RlLnJlZHVjdGlvbik7XG4gICAgICBmaXhTZXRUYXJnZXQobm9kZS5hdHRhY2spO1xuICAgICAgZml4U2V0VGFyZ2V0KG5vZGUucmVsZWFzZSk7XG4gICAgICByZXR1cm4gbm9kZTtcbiAgICB9O1xuXG4gICAgQXVkaW9Db250ZXh0LnByb3RvdHlwZS5pbnRlcm5hbF9jcmVhdGVCaXF1YWRGaWx0ZXIgPSBBdWRpb0NvbnRleHQucHJvdG90eXBlLmNyZWF0ZUJpcXVhZEZpbHRlcjtcbiAgICBBdWRpb0NvbnRleHQucHJvdG90eXBlLmNyZWF0ZUJpcXVhZEZpbHRlciA9IGZ1bmN0aW9uKCkgeyBcbiAgICAgIHZhciBub2RlID0gdGhpcy5pbnRlcm5hbF9jcmVhdGVCaXF1YWRGaWx0ZXIoKTtcbiAgICAgIGZpeFNldFRhcmdldChub2RlLmZyZXF1ZW5jeSk7XG4gICAgICBmaXhTZXRUYXJnZXQobm9kZS5kZXR1bmUpO1xuICAgICAgZml4U2V0VGFyZ2V0KG5vZGUuUSk7XG4gICAgICBmaXhTZXRUYXJnZXQobm9kZS5nYWluKTtcbiAgICAgIHJldHVybiBub2RlO1xuICAgIH07XG5cbiAgICBpZiAoQXVkaW9Db250ZXh0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eSggJ2NyZWF0ZU9zY2lsbGF0b3InICkpIHtcbiAgICAgIEF1ZGlvQ29udGV4dC5wcm90b3R5cGUuaW50ZXJuYWxfY3JlYXRlT3NjaWxsYXRvciA9IEF1ZGlvQ29udGV4dC5wcm90b3R5cGUuY3JlYXRlT3NjaWxsYXRvcjtcbiAgICAgIEF1ZGlvQ29udGV4dC5wcm90b3R5cGUuY3JlYXRlT3NjaWxsYXRvciA9IGZ1bmN0aW9uKCkgeyBcbiAgICAgICAgdmFyIG5vZGUgPSB0aGlzLmludGVybmFsX2NyZWF0ZU9zY2lsbGF0b3IoKTtcbiAgICAgICAgaWYgKCFub2RlLnN0YXJ0KVxuICAgICAgICAgIG5vZGUuc3RhcnQgPSBub2RlLm5vdGVPbjsgXG4gICAgICAgIGlmICghbm9kZS5zdG9wKVxuICAgICAgICAgIG5vZGUuc3RvcCA9IG5vZGUubm90ZU9mZjtcbiAgICAgICAgaWYgKCFub2RlLnNldFBlcmlvZGljV2F2ZSlcbiAgICAgICAgICBub2RlLnNldFBlcmlvZGljV2F2ZSA9IG5vZGUuc2V0V2F2ZVRhYmxlO1xuICAgICAgICBmaXhTZXRUYXJnZXQobm9kZS5mcmVxdWVuY3kpO1xuICAgICAgICBmaXhTZXRUYXJnZXQobm9kZS5kZXR1bmUpO1xuICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgIH07XG4gICAgfVxuICB9XG59KHdpbmRvdykpOyIsIi8qZ2xvYmFscyBBdWRpb0NvbnRleHQqL1xucmVxdWlyZSgnLi9hYy1tb25rZXlwYXRjaCcpO1xud2luZG93LndhdmVzID0gd2luZG93LndhdmVzIHx8IHt9O1xubW9kdWxlLmV4cG9ydHMgPSB3aW5kb3cud2F2ZXMuYXVkaW9Db250ZXh0ID0gd2luZG93LndhdmVzLmF1ZGlvQ29udGV4dCB8fCBuZXcgQXVkaW9Db250ZXh0KCk7IiwiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKipcbiAqIEFVVEhPUiBPRiBJTklUSUFMIEpTIExJQlJBUllcbiAqIGstZCBUcmVlIEphdmFTY3JpcHQgLSBWIDEuMFxuICpcbiAqIGh0dHBzOi8vZ2l0aHViLmNvbS91YmlsYWJzL2tkLXRyZWUtamF2YXNjcmlwdFxuICpcbiAqIEBhdXRob3IgTWlyY2VhIFByaWNvcCA8cHJpY29wQHViaWxhYnMubmV0PiwgMjAxMlxuICogQGF1dGhvciBNYXJ0aW4gS2xlcHBlIDxrbGVwcGVAdWJpbGFicy5uZXQ+LCAyMDEyXG4gKiBAYXV0aG9yIFViaWxhYnMgaHR0cDovL3ViaWxhYnMubmV0LCAyMDEyXG4gKiBAbGljZW5zZSBNSVQgTGljZW5zZSA8aHR0cDovL3d3dy5vcGVuc291cmNlLm9yZy9saWNlbnNlcy9taXQtbGljZW5zZS5waHA+XG4gKi9cblxuXG5mdW5jdGlvbiBOb2RlKG9iaiwgZGltZW5zaW9uLCBwYXJlbnQpIHtcbiAgdGhpcy5vYmogPSBvYmo7XG4gIHRoaXMubGVmdCA9IG51bGw7XG4gIHRoaXMucmlnaHQgPSBudWxsO1xuICB0aGlzLnBhcmVudCA9IHBhcmVudDtcbiAgdGhpcy5kaW1lbnNpb24gPSBkaW1lbnNpb247XG59XG5cbmZ1bmN0aW9uIEtkVHJlZShwb2ludHMsIG1ldHJpYywgZGltZW5zaW9ucykge1xuXG4gIHZhciBzZWxmID0gdGhpcztcbiAgXG4gIGZ1bmN0aW9uIGJ1aWxkVHJlZShwb2ludHMsIGRlcHRoLCBwYXJlbnQpIHtcbiAgICB2YXIgZGltID0gZGVwdGggJSBkaW1lbnNpb25zLmxlbmd0aCxcbiAgICAgIG1lZGlhbixcbiAgICAgIG5vZGU7XG5cbiAgICBpZiAocG9pbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGlmIChwb2ludHMubGVuZ3RoID09PSAxKSB7XG4gICAgICByZXR1cm4gbmV3IE5vZGUocG9pbnRzWzBdLCBkaW0sIHBhcmVudCk7XG4gICAgfVxuXG4gICAgcG9pbnRzLnNvcnQoZnVuY3Rpb24gKGEsIGIpIHtcbiAgICAgIHJldHVybiBhW2RpbWVuc2lvbnNbZGltXV0gLSBiW2RpbWVuc2lvbnNbZGltXV07XG4gICAgfSk7XG5cbiAgICBtZWRpYW4gPSBNYXRoLmZsb29yKHBvaW50cy5sZW5ndGggLyAyKTtcbiAgICBub2RlID0gbmV3IE5vZGUocG9pbnRzW21lZGlhbl0sIGRpbSwgcGFyZW50KTtcbiAgICBub2RlLmxlZnQgPSBidWlsZFRyZWUocG9pbnRzLnNsaWNlKDAsIG1lZGlhbiksIGRlcHRoICsgMSwgbm9kZSk7XG4gICAgbm9kZS5yaWdodCA9IGJ1aWxkVHJlZShwb2ludHMuc2xpY2UobWVkaWFuICsgMSksIGRlcHRoICsgMSwgbm9kZSk7XG5cbiAgICByZXR1cm4gbm9kZTtcbiAgfVxuXG4gIHRoaXMucm9vdCA9IGJ1aWxkVHJlZShwb2ludHMsIDAsIG51bGwpO1xuXG4gIHRoaXMuaW5zZXJ0ID0gZnVuY3Rpb24gKHBvaW50KSB7XG4gICAgZnVuY3Rpb24gaW5uZXJTZWFyY2gobm9kZSwgcGFyZW50KSB7XG5cbiAgICAgIGlmIChub2RlID09PSBudWxsKSB7XG4gICAgICAgIHJldHVybiBwYXJlbnQ7XG4gICAgICB9XG5cbiAgICAgIHZhciBkaW1lbnNpb24gPSBkaW1lbnNpb25zW25vZGUuZGltZW5zaW9uXTtcbiAgICAgIGlmIChwb2ludFtkaW1lbnNpb25dIDwgbm9kZS5vYmpbZGltZW5zaW9uXSkge1xuICAgICAgICByZXR1cm4gaW5uZXJTZWFyY2gobm9kZS5sZWZ0LCBub2RlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBpbm5lclNlYXJjaChub2RlLnJpZ2h0LCBub2RlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgaW5zZXJ0UG9zaXRpb24gPSBpbm5lclNlYXJjaCh0aGlzLnJvb3QsIG51bGwpLFxuICAgICAgbmV3Tm9kZSxcbiAgICAgIGRpbWVuc2lvbjtcblxuICAgIGlmIChpbnNlcnRQb3NpdGlvbiA9PT0gbnVsbCkge1xuICAgICAgdGhpcy5yb290ID0gbmV3IE5vZGUocG9pbnQsIDAsIG51bGwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIG5ld05vZGUgPSBuZXcgTm9kZShwb2ludCwgKGluc2VydFBvc2l0aW9uLmRpbWVuc2lvbiArIDEpICUgZGltZW5zaW9ucy5sZW5ndGgsIGluc2VydFBvc2l0aW9uKTtcbiAgICBkaW1lbnNpb24gPSBkaW1lbnNpb25zW2luc2VydFBvc2l0aW9uLmRpbWVuc2lvbl07XG5cbiAgICBpZiAocG9pbnRbZGltZW5zaW9uXSA8IGluc2VydFBvc2l0aW9uLm9ialtkaW1lbnNpb25dKSB7XG4gICAgICBpbnNlcnRQb3NpdGlvbi5sZWZ0ID0gbmV3Tm9kZTtcbiAgICB9IGVsc2Uge1xuICAgICAgaW5zZXJ0UG9zaXRpb24ucmlnaHQgPSBuZXdOb2RlO1xuICAgIH1cbiAgfTtcblxuICB0aGlzLnJlbW92ZSA9IGZ1bmN0aW9uIChwb2ludCkge1xuICAgIHZhciBub2RlO1xuXG4gICAgZnVuY3Rpb24gbm9kZVNlYXJjaChub2RlKSB7XG4gICAgICBpZiAobm9kZSA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cblxuICAgICAgaWYgKG5vZGUub2JqID09PSBwb2ludCkge1xuICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgIH1cblxuICAgICAgdmFyIGRpbWVuc2lvbiA9IGRpbWVuc2lvbnNbbm9kZS5kaW1lbnNpb25dO1xuXG4gICAgICBpZiAocG9pbnRbZGltZW5zaW9uXSA8IG5vZGUub2JqW2RpbWVuc2lvbl0pIHtcbiAgICAgICAgcmV0dXJuIG5vZGVTZWFyY2gobm9kZS5sZWZ0LCBub2RlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBub2RlU2VhcmNoKG5vZGUucmlnaHQsIG5vZGUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbW92ZU5vZGUobm9kZSkge1xuICAgICAgdmFyIG5leHROb2RlLFxuICAgICAgICBuZXh0T2JqLFxuICAgICAgICBwRGltZW5zaW9uO1xuXG4gICAgICBmdW5jdGlvbiBmaW5kTWF4KG5vZGUsIGRpbSkge1xuICAgICAgICB2YXIgZGltZW5zaW9uLFxuICAgICAgICAgIG93bixcbiAgICAgICAgICBsZWZ0LFxuICAgICAgICAgIHJpZ2h0LFxuICAgICAgICAgIG1heDtcblxuICAgICAgICBpZiAobm9kZSA9PT0gbnVsbCkge1xuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgZGltZW5zaW9uID0gZGltZW5zaW9uc1tkaW1dO1xuICAgICAgICBpZiAobm9kZS5kaW1lbnNpb24gPT09IGRpbSkge1xuICAgICAgICAgIGlmIChub2RlLnJpZ2h0ICE9PSBudWxsKSB7XG4gICAgICAgICAgICByZXR1cm4gZmluZE1heChub2RlLnJpZ2h0LCBkaW0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgICAgfVxuXG4gICAgICAgIG93biA9IG5vZGUub2JqW2RpbWVuc2lvbl07XG4gICAgICAgIGxlZnQgPSBmaW5kTWF4KG5vZGUubGVmdCwgZGltKTtcbiAgICAgICAgcmlnaHQgPSBmaW5kTWF4KG5vZGUucmlnaHQsIGRpbSk7XG4gICAgICAgIG1heCA9IG5vZGU7XG5cbiAgICAgICAgaWYgKGxlZnQgIT09IG51bGwgJiYgbGVmdC5vYmpbZGltZW5zaW9uXSA+IG93bikge1xuICAgICAgICAgIG1heCA9IGxlZnQ7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocmlnaHQgIT09IG51bGwgJiYgcmlnaHQub2JqW2RpbWVuc2lvbl0gPiBtYXgub2JqW2RpbWVuc2lvbl0pIHtcbiAgICAgICAgICBtYXggPSByaWdodDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbWF4O1xuICAgICAgfVxuXG4gICAgICBmdW5jdGlvbiBmaW5kTWluKG5vZGUsIGRpbSkge1xuICAgICAgICB2YXIgZGltZW5zaW9uLFxuICAgICAgICAgIG93bixcbiAgICAgICAgICBsZWZ0LFxuICAgICAgICAgIHJpZ2h0LFxuICAgICAgICAgIG1pbjtcblxuICAgICAgICBpZiAobm9kZSA9PT0gbnVsbCkge1xuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgZGltZW5zaW9uID0gZGltZW5zaW9uc1tkaW1dO1xuXG4gICAgICAgIGlmIChub2RlLmRpbWVuc2lvbiA9PT0gZGltKSB7XG4gICAgICAgICAgaWYgKG5vZGUubGVmdCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgcmV0dXJuIGZpbmRNaW4obm9kZS5sZWZ0LCBkaW0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgICAgfVxuXG4gICAgICAgIG93biA9IG5vZGUub2JqW2RpbWVuc2lvbl07XG4gICAgICAgIGxlZnQgPSBmaW5kTWluKG5vZGUubGVmdCwgZGltKTtcbiAgICAgICAgcmlnaHQgPSBmaW5kTWluKG5vZGUucmlnaHQsIGRpbSk7XG4gICAgICAgIG1pbiA9IG5vZGU7XG5cbiAgICAgICAgaWYgKGxlZnQgIT09IG51bGwgJiYgbGVmdC5vYmpbZGltZW5zaW9uXSA8IG93bikge1xuICAgICAgICAgIG1pbiA9IGxlZnQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJpZ2h0ICE9PSBudWxsICYmIHJpZ2h0Lm9ialtkaW1lbnNpb25dIDwgbWluLm9ialtkaW1lbnNpb25dKSB7XG4gICAgICAgICAgbWluID0gcmlnaHQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG1pbjtcbiAgICAgIH1cblxuICAgICAgaWYgKG5vZGUubGVmdCA9PT0gbnVsbCAmJiBub2RlLnJpZ2h0ID09PSBudWxsKSB7XG4gICAgICAgIGlmIChub2RlLnBhcmVudCA9PT0gbnVsbCkge1xuICAgICAgICAgIHNlbGYucm9vdCA9IG51bGw7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgcERpbWVuc2lvbiA9IGRpbWVuc2lvbnNbbm9kZS5wYXJlbnQuZGltZW5zaW9uXTtcblxuICAgICAgICBpZiAobm9kZS5vYmpbcERpbWVuc2lvbl0gPCBub2RlLnBhcmVudC5vYmpbcERpbWVuc2lvbl0pIHtcbiAgICAgICAgICBub2RlLnBhcmVudC5sZWZ0ID0gbnVsbDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBub2RlLnBhcmVudC5yaWdodCA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAobm9kZS5sZWZ0ICE9PSBudWxsKSB7XG4gICAgICAgIG5leHROb2RlID0gZmluZE1heChub2RlLmxlZnQsIG5vZGUuZGltZW5zaW9uKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG5leHROb2RlID0gZmluZE1pbihub2RlLnJpZ2h0LCBub2RlLmRpbWVuc2lvbik7XG4gICAgICB9XG5cbiAgICAgIG5leHRPYmogPSBuZXh0Tm9kZS5vYmo7XG4gICAgICByZW1vdmVOb2RlKG5leHROb2RlKTtcbiAgICAgIG5vZGUub2JqID0gbmV4dE9iajtcblxuICAgIH1cblxuICAgIG5vZGUgPSBub2RlU2VhcmNoKHNlbGYucm9vdCk7XG5cbiAgICBpZiAobm9kZSA9PT0gbnVsbCkgeyByZXR1cm47IH1cblxuICAgIHJlbW92ZU5vZGUobm9kZSk7XG4gIH07XG5cbiAgdGhpcy5uZWFyZXN0ID0gZnVuY3Rpb24gKHBvaW50LCBtYXhOb2RlcywgbWF4RGlzdGFuY2UpIHtcbiAgICB2YXIgaSxcbiAgICAgIHJlc3VsdCxcbiAgICAgIGJlc3ROb2RlcztcblxuICAgIGJlc3ROb2RlcyA9IG5ldyBCaW5hcnlIZWFwKFxuICAgICAgZnVuY3Rpb24gKGUpIHsgcmV0dXJuIC1lWzFdOyB9XG4gICAgKTtcblxuICAgIGZ1bmN0aW9uIG5lYXJlc3RTZWFyY2gobm9kZSkge1xuICAgICAgdmFyIGJlc3RDaGlsZCxcbiAgICAgICAgZGltZW5zaW9uID0gZGltZW5zaW9uc1tub2RlLmRpbWVuc2lvbl0sXG4gICAgICAgIG93bkRpc3RhbmNlID0gbWV0cmljKHBvaW50LCBub2RlLm9iaiksXG4gICAgICAgIGxpbmVhclBvaW50ID0ge30sXG4gICAgICAgIGxpbmVhckRpc3RhbmNlLFxuICAgICAgICBvdGhlckNoaWxkLFxuICAgICAgICBpO1xuXG4gICAgICBmdW5jdGlvbiBzYXZlTm9kZShub2RlLCBkaXN0YW5jZSkge1xuICAgICAgICBiZXN0Tm9kZXMucHVzaChbbm9kZSwgZGlzdGFuY2VdKTtcbiAgICAgICAgaWYgKGJlc3ROb2Rlcy5zaXplKCkgPiBtYXhOb2Rlcykge1xuICAgICAgICAgIGJlc3ROb2Rlcy5wb3AoKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBmb3IgKGkgPSAwOyBpIDwgZGltZW5zaW9ucy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICBpZiAoaSA9PT0gbm9kZS5kaW1lbnNpb24pIHtcbiAgICAgICAgICBsaW5lYXJQb2ludFtkaW1lbnNpb25zW2ldXSA9IHBvaW50W2RpbWVuc2lvbnNbaV1dO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGxpbmVhclBvaW50W2RpbWVuc2lvbnNbaV1dID0gbm9kZS5vYmpbZGltZW5zaW9uc1tpXV07XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgbGluZWFyRGlzdGFuY2UgPSBtZXRyaWMobGluZWFyUG9pbnQsIG5vZGUub2JqKTtcblxuICAgICAgaWYgKG5vZGUucmlnaHQgPT09IG51bGwgJiYgbm9kZS5sZWZ0ID09PSBudWxsKSB7XG4gICAgICAgIGlmIChiZXN0Tm9kZXMuc2l6ZSgpIDwgbWF4Tm9kZXMgfHwgb3duRGlzdGFuY2UgPCBiZXN0Tm9kZXMucGVlaygpWzFdKSB7XG4gICAgICAgICAgc2F2ZU5vZGUobm9kZSwgb3duRGlzdGFuY2UpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKG5vZGUucmlnaHQgPT09IG51bGwpIHtcbiAgICAgICAgYmVzdENoaWxkID0gbm9kZS5sZWZ0O1xuICAgICAgfSBlbHNlIGlmIChub2RlLmxlZnQgPT09IG51bGwpIHtcbiAgICAgICAgYmVzdENoaWxkID0gbm9kZS5yaWdodDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChwb2ludFtkaW1lbnNpb25dIDwgbm9kZS5vYmpbZGltZW5zaW9uXSkge1xuICAgICAgICAgIGJlc3RDaGlsZCA9IG5vZGUubGVmdDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBiZXN0Q2hpbGQgPSBub2RlLnJpZ2h0O1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIG5lYXJlc3RTZWFyY2goYmVzdENoaWxkKTtcblxuICAgICAgaWYgKGJlc3ROb2Rlcy5zaXplKCkgPCBtYXhOb2RlcyB8fCBvd25EaXN0YW5jZSA8IGJlc3ROb2Rlcy5wZWVrKClbMV0pIHtcbiAgICAgICAgc2F2ZU5vZGUobm9kZSwgb3duRGlzdGFuY2UpO1xuICAgICAgfVxuXG4gICAgICBpZiAoYmVzdE5vZGVzLnNpemUoKSA8IG1heE5vZGVzIHx8IE1hdGguYWJzKGxpbmVhckRpc3RhbmNlKSA8IGJlc3ROb2Rlcy5wZWVrKClbMV0pIHtcbiAgICAgICAgaWYgKGJlc3RDaGlsZCA9PT0gbm9kZS5sZWZ0KSB7XG4gICAgICAgICAgb3RoZXJDaGlsZCA9IG5vZGUucmlnaHQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgb3RoZXJDaGlsZCA9IG5vZGUubGVmdDtcbiAgICAgICAgfVxuICAgICAgICBpZiAob3RoZXJDaGlsZCAhPT0gbnVsbCkge1xuICAgICAgICAgIG5lYXJlc3RTZWFyY2gob3RoZXJDaGlsZCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAobWF4RGlzdGFuY2UpIHtcbiAgICAgIGZvciAoaSA9IDA7IGkgPCBtYXhOb2RlczsgaSArPSAxKSB7XG4gICAgICAgIGJlc3ROb2Rlcy5wdXNoKFtudWxsLCBtYXhEaXN0YW5jZV0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIG5lYXJlc3RTZWFyY2goc2VsZi5yb290KTtcblxuICAgIHJlc3VsdCA9IFtdO1xuXG4gICAgZm9yIChpID0gMDsgaSA8IG1heE5vZGVzOyBpICs9IDEpIHtcbiAgICAgIGlmIChiZXN0Tm9kZXMuY29udGVudFtpXVswXSkge1xuICAgICAgICByZXN1bHQucHVzaChbYmVzdE5vZGVzLmNvbnRlbnRbaV1bMF0ub2JqLCBiZXN0Tm9kZXMuY29udGVudFtpXVsxXV0pO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIHRoaXMuYmFsYW5jZUZhY3RvciA9IGZ1bmN0aW9uICgpIHtcbiAgICBmdW5jdGlvbiBoZWlnaHQobm9kZSkge1xuICAgICAgaWYgKG5vZGUgPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgICB9XG4gICAgICByZXR1cm4gTWF0aC5tYXgoaGVpZ2h0KG5vZGUubGVmdCksIGhlaWdodChub2RlLnJpZ2h0KSkgKyAxO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNvdW50KG5vZGUpIHtcbiAgICAgIGlmIChub2RlID09PSBudWxsKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGNvdW50KG5vZGUubGVmdCkgKyBjb3VudChub2RlLnJpZ2h0KSArIDE7XG4gICAgfVxuXG4gICAgcmV0dXJuIGhlaWdodChzZWxmLnJvb3QpIC8gKE1hdGgubG9nKGNvdW50KHNlbGYucm9vdCkpIC8gTWF0aC5sb2coMikpO1xuICB9O1xufVxuXG4vLyBCaW5hcnkgaGVhcCBpbXBsZW1lbnRhdGlvbiBmcm9tOlxuLy8gaHR0cDovL2Vsb3F1ZW50amF2YXNjcmlwdC5uZXQvYXBwZW5kaXgyLmh0bWxcblxuZnVuY3Rpb24gQmluYXJ5SGVhcChzY29yZUZ1bmN0aW9uKXtcbiAgdGhpcy5jb250ZW50ID0gW107XG4gIHRoaXMuc2NvcmVGdW5jdGlvbiA9IHNjb3JlRnVuY3Rpb247XG59XG5cbkJpbmFyeUhlYXAucHJvdG90eXBlID0ge1xuICBwdXNoOiBmdW5jdGlvbihlbGVtZW50KSB7XG4gICAgLy8gQWRkIHRoZSBuZXcgZWxlbWVudCB0byB0aGUgZW5kIG9mIHRoZSBhcnJheS5cbiAgICB0aGlzLmNvbnRlbnQucHVzaChlbGVtZW50KTtcbiAgICAvLyBBbGxvdyBpdCB0byBidWJibGUgdXAuXG4gICAgdGhpcy5idWJibGVVcCh0aGlzLmNvbnRlbnQubGVuZ3RoIC0gMSk7XG4gIH0sXG5cbiAgcG9wOiBmdW5jdGlvbigpIHtcbiAgICAvLyBTdG9yZSB0aGUgZmlyc3QgZWxlbWVudCBzbyB3ZSBjYW4gcmV0dXJuIGl0IGxhdGVyLlxuICAgIHZhciByZXN1bHQgPSB0aGlzLmNvbnRlbnRbMF07XG4gICAgLy8gR2V0IHRoZSBlbGVtZW50IGF0IHRoZSBlbmQgb2YgdGhlIGFycmF5LlxuICAgIHZhciBlbmQgPSB0aGlzLmNvbnRlbnQucG9wKCk7XG4gICAgLy8gSWYgdGhlcmUgYXJlIGFueSBlbGVtZW50cyBsZWZ0LCBwdXQgdGhlIGVuZCBlbGVtZW50IGF0IHRoZVxuICAgIC8vIHN0YXJ0LCBhbmQgbGV0IGl0IHNpbmsgZG93bi5cbiAgICBpZiAodGhpcy5jb250ZW50Lmxlbmd0aCA+IDApIHtcbiAgICAgIHRoaXMuY29udGVudFswXSA9IGVuZDtcbiAgICAgIHRoaXMuc2lua0Rvd24oMCk7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH0sXG5cbiAgcGVlazogZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuY29udGVudFswXTtcbiAgfSxcblxuICByZW1vdmU6IGZ1bmN0aW9uKG5vZGUpIHtcbiAgICB2YXIgbGVuID0gdGhpcy5jb250ZW50Lmxlbmd0aDtcbiAgICAvLyBUbyByZW1vdmUgYSB2YWx1ZSwgd2UgbXVzdCBzZWFyY2ggdGhyb3VnaCB0aGUgYXJyYXkgdG8gZmluZFxuICAgIC8vIGl0LlxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIGlmICh0aGlzLmNvbnRlbnRbaV0gPT0gbm9kZSkge1xuICAgICAgICAvLyBXaGVuIGl0IGlzIGZvdW5kLCB0aGUgcHJvY2VzcyBzZWVuIGluICdwb3AnIGlzIHJlcGVhdGVkXG4gICAgICAgIC8vIHRvIGZpbGwgdXAgdGhlIGhvbGUuXG4gICAgICAgIHZhciBlbmQgPSB0aGlzLmNvbnRlbnQucG9wKCk7XG4gICAgICAgIGlmIChpICE9IGxlbiAtIDEpIHtcbiAgICAgICAgICB0aGlzLmNvbnRlbnRbaV0gPSBlbmQ7XG4gICAgICAgICAgaWYgKHRoaXMuc2NvcmVGdW5jdGlvbihlbmQpIDwgdGhpcy5zY29yZUZ1bmN0aW9uKG5vZGUpKVxuICAgICAgICAgICAgdGhpcy5idWJibGVVcChpKTtcbiAgICAgICAgICBlbHNlXG4gICAgICAgICAgICB0aGlzLnNpbmtEb3duKGkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiTm9kZSBub3QgZm91bmQuXCIpO1xuICB9LFxuXG4gIHNpemU6IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmNvbnRlbnQubGVuZ3RoO1xuICB9LFxuXG4gIGJ1YmJsZVVwOiBmdW5jdGlvbihuKSB7XG4gICAgLy8gRmV0Y2ggdGhlIGVsZW1lbnQgdGhhdCBoYXMgdG8gYmUgbW92ZWQuXG4gICAgdmFyIGVsZW1lbnQgPSB0aGlzLmNvbnRlbnRbbl07XG4gICAgLy8gV2hlbiBhdCAwLCBhbiBlbGVtZW50IGNhbiBub3QgZ28gdXAgYW55IGZ1cnRoZXIuXG4gICAgd2hpbGUgKG4gPiAwKSB7XG4gICAgICAvLyBDb21wdXRlIHRoZSBwYXJlbnQgZWxlbWVudCdzIGluZGV4LCBhbmQgZmV0Y2ggaXQuXG4gICAgICB2YXIgcGFyZW50TiA9IE1hdGguZmxvb3IoKG4gKyAxKSAvIDIpIC0gMSxcbiAgICAgICAgICBwYXJlbnQgPSB0aGlzLmNvbnRlbnRbcGFyZW50Tl07XG4gICAgICAvLyBTd2FwIHRoZSBlbGVtZW50cyBpZiB0aGUgcGFyZW50IGlzIGdyZWF0ZXIuXG4gICAgICBpZiAodGhpcy5zY29yZUZ1bmN0aW9uKGVsZW1lbnQpIDwgdGhpcy5zY29yZUZ1bmN0aW9uKHBhcmVudCkpIHtcbiAgICAgICAgdGhpcy5jb250ZW50W3BhcmVudE5dID0gZWxlbWVudDtcbiAgICAgICAgdGhpcy5jb250ZW50W25dID0gcGFyZW50O1xuICAgICAgICAvLyBVcGRhdGUgJ24nIHRvIGNvbnRpbnVlIGF0IHRoZSBuZXcgcG9zaXRpb24uXG4gICAgICAgIG4gPSBwYXJlbnROO1xuICAgICAgfVxuICAgICAgLy8gRm91bmQgYSBwYXJlbnQgdGhhdCBpcyBsZXNzLCBubyBuZWVkIHRvIG1vdmUgaXQgZnVydGhlci5cbiAgICAgIGVsc2Uge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgc2lua0Rvd246IGZ1bmN0aW9uKG4pIHtcbiAgICAvLyBMb29rIHVwIHRoZSB0YXJnZXQgZWxlbWVudCBhbmQgaXRzIHNjb3JlLlxuICAgIHZhciBsZW5ndGggPSB0aGlzLmNvbnRlbnQubGVuZ3RoLFxuICAgICAgICBlbGVtZW50ID0gdGhpcy5jb250ZW50W25dLFxuICAgICAgICBlbGVtU2NvcmUgPSB0aGlzLnNjb3JlRnVuY3Rpb24oZWxlbWVudCk7XG5cbiAgICB3aGlsZSh0cnVlKSB7XG4gICAgICAvLyBDb21wdXRlIHRoZSBpbmRpY2VzIG9mIHRoZSBjaGlsZCBlbGVtZW50cy5cbiAgICAgIHZhciBjaGlsZDJOID0gKG4gKyAxKSAqIDIsIGNoaWxkMU4gPSBjaGlsZDJOIC0gMTtcbiAgICAgIC8vIFRoaXMgaXMgdXNlZCB0byBzdG9yZSB0aGUgbmV3IHBvc2l0aW9uIG9mIHRoZSBlbGVtZW50LFxuICAgICAgLy8gaWYgYW55LlxuICAgICAgdmFyIHN3YXAgPSBudWxsO1xuICAgICAgLy8gSWYgdGhlIGZpcnN0IGNoaWxkIGV4aXN0cyAoaXMgaW5zaWRlIHRoZSBhcnJheSkuLi5cbiAgICAgIGlmIChjaGlsZDFOIDwgbGVuZ3RoKSB7XG4gICAgICAgIC8vIExvb2sgaXQgdXAgYW5kIGNvbXB1dGUgaXRzIHNjb3JlLlxuICAgICAgICB2YXIgY2hpbGQxID0gdGhpcy5jb250ZW50W2NoaWxkMU5dLFxuICAgICAgICAgICAgY2hpbGQxU2NvcmUgPSB0aGlzLnNjb3JlRnVuY3Rpb24oY2hpbGQxKTtcbiAgICAgICAgLy8gSWYgdGhlIHNjb3JlIGlzIGxlc3MgdGhhbiBvdXIgZWxlbWVudCdzLCB3ZSBuZWVkIHRvIHN3YXAuXG4gICAgICAgIGlmIChjaGlsZDFTY29yZSA8IGVsZW1TY29yZSlcbiAgICAgICAgICBzd2FwID0gY2hpbGQxTjtcbiAgICAgIH1cbiAgICAgIC8vIERvIHRoZSBzYW1lIGNoZWNrcyBmb3IgdGhlIG90aGVyIGNoaWxkLlxuICAgICAgaWYgKGNoaWxkMk4gPCBsZW5ndGgpIHtcbiAgICAgICAgdmFyIGNoaWxkMiA9IHRoaXMuY29udGVudFtjaGlsZDJOXSxcbiAgICAgICAgICAgIGNoaWxkMlNjb3JlID0gdGhpcy5zY29yZUZ1bmN0aW9uKGNoaWxkMik7XG4gICAgICAgIGlmIChjaGlsZDJTY29yZSA8IChzd2FwID09IG51bGwgPyBlbGVtU2NvcmUgOiBjaGlsZDFTY29yZSkpe1xuICAgICAgICAgIHN3YXAgPSBjaGlsZDJOO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIElmIHRoZSBlbGVtZW50IG5lZWRzIHRvIGJlIG1vdmVkLCBzd2FwIGl0LCBhbmQgY29udGludWUuXG4gICAgICBpZiAoc3dhcCAhPSBudWxsKSB7XG4gICAgICAgIHRoaXMuY29udGVudFtuXSA9IHRoaXMuY29udGVudFtzd2FwXTtcbiAgICAgICAgdGhpcy5jb250ZW50W3N3YXBdID0gZWxlbWVudDtcbiAgICAgICAgbiA9IHN3YXA7XG4gICAgICB9XG4gICAgICAvLyBPdGhlcndpc2UsIHdlIGFyZSBkb25lLlxuICAgICAgZWxzZSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIGNyZWF0ZUtkVHJlZTogZnVuY3Rpb24gKHBvaW50cywgbWV0cmljLCBkaW1lbnNpb25zKSB7XG4gICAgcmV0dXJuIG5ldyBLZFRyZWUocG9pbnRzLCBtZXRyaWMsIGRpbWVuc2lvbnMpXG4gIH1cbn1cbiJdfQ==
(1)
});
