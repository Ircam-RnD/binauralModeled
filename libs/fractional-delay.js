!function(e){if("object"==typeof exports)module.exports=e();else if("function"==typeof define&&define.amd)define(e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.createFractionalDelay=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
/**
 * @fileoverview Fractional delay library
 * @author Arnau Julià <Arnau.Julia@gmail.com>
 * @version 0.1.0
 */


/**
 * Function invocation pattern for object creation.
 * @public
 */

var createFractionalDelay = function createFractionalDelay(sampleRate, optMaxDelayTime) {
  'use strict';

  /**
   * ECMAScript5 property descriptors object.
   */

  var fractionalDelayObject = {

    // Properties with default values
    delayTime: {
      writable: true,
      value: 0
    },
    maxDelayTime: {
      writable: true,
      value: 1
    },
    posRead: {
      writable: true,
      value: 0
    },
    posWrite: {
      writable: true,
      value: 0
    },
    fracXi1: {
      writable: true,
      value: 0
    },
    fracXi2: {
      writable: true,
      value: 0
    },
    fracYi1: {
      writable: true,
      value: 0
    },
    intDelay: {
      writable: true,
      value: 0
    },
    fracDelay: {
      writable: true,
      value: 0
    },

    // Other properties
    sampleRate: {
      writable: true
    },
    buffer: { 
      writable: true
    },
    bufferSize: {
      writable: true,
    },
    a1: {
      writable: true,
    },

    /**
     * Mandatory initialization method.
     * @public
     * @param units:Hz sampleRate Sample Rate the apparatus operates on.
     * @param type:Float units:s min:0.0 default:1 optMaxDelayTime The maximum delay time.
     * @chainable
     */
    init: {
      enumerable: true,
      value: function(sampleRate, optMaxDelayTime) {
        // Save sample rate
        this.sampleRate = sampleRate;
        this.maxDelayTime = optMaxDelayTime || this.maxDelayTime;

        this.bufferSize = this.maxDelayTime * this.sampleRate;
        // Check if the bufferSize is not an integer
        if(this.bufferSize  % 1 !== 0){
          this.bufferSize = parseInt(this.bufferSize) + 1;
        }
        // Create the internal buffer
        this.buffer = new Float32Array(this.bufferSize);

        return this; // for chainability
      }
    },

    /**
     * Set delay value
     * @param delayTime Delay time
     * @public
     */
    setDelay: {
      enumerable: true,
      value: function(delayTime) {
        if(delayTime < this.maxDelayTime){
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
          if(this.fracDelay!==0) {
            this.updateThiranCoefficient();
          }
        }else{
          console.log("throw error...how?");
        }
      }
    },

    /**
     * Update delay value
     * @public
     */
    getDelay: {
      enumerable: true,
      value: function() {
        return this.delayTime;
      }
    },

    /**
     * Process method, where the output is calculated.
     * @param inputBuffer Input Array
     * @public
     */
    process: {
      enumerable: true,
      value: function(inputBuffer) {
        // Creates the outputBuffer, with the same length of the input
        var outputBuffer = new Float32Array(inputBuffer.length);

        // Integer delay process section 
        for(var i = 0; i<inputBuffer.length; i = i + 1) {
          // Save the input value in the buffer
          this.buffer[this.posWrite] = inputBuffer[i];
          // Write the outputBuffer with the [inputValue - delay] sample
          outputBuffer[i] = this.buffer[this.posRead];
          // Update the value of posRead and posWrite pointers
          this.updatePointers();
        }
        // No fractional delay
        if(this.fracDelay === 0 ) {
          return outputBuffer;
        } else {
          // The fractional delay process section
          outputBuffer = new Float32Array(this.fractionalThiranProcess(outputBuffer));
          return outputBuffer;
        }
      }
    },

    /**
     * Update the value of posRead and posWrite pointers inside the circular buffer
     * @private
     */
    updatePointers: {
      enumerable: false,
      value: function() {
        // It's a circular buffer, so, when it is at the last position, the pointer return to the first position

        // Update posWrite pointer
        if(this.posWrite === (this.buffer.length-1)) {
          this.posWrite = 0;
        } else {
          this.posWrite = this.posWrite + 1;
        }

        // Update posRead pointer
        if(this.posRead === (this.buffer.length-1)) {
          this.posRead = 0;
        } else {
          this.posRead = this.posRead + 1;
        }
      }
    },

    /**
     * Update Thiran coefficient (1st order Thiran)
     * @private
     */
    updateThiranCoefficient: {
      enumerable: false,
      value: function() {
        // Update the coefficient: (1-D)/(1+D) where D is fractional delay
        this.a1 = (1-this.fracDelay)/(1+this.fracDelay);
      }
    },

    /**
     * Update the pointer posRead value when the delay value is changed
     * @private
     */
    resample: {
      enumerable: false,
      value: function() {
        if(this.posWrite-this.intDelay < 0) {
          var pos = this.intDelay - this.posWrite;
          this.posRead = this.buffer.length - pos;
        } else {
          this.posRead = this.posWrite - this.intDelay;
        }
      }
    },

    /**
     * Fractional process method.
     * @private
     * @param inputBuffer Input Array
     */
    fractionalThiranProcess: {
      enumerable: false,
      value: function(inputBuffer) {
        var outputBuffer = new Float32Array(inputBuffer.length);

        var x, y;
        var xi1 = this.fracXi1;
        var xi2 = this.fracXi2;
        var yi1 = this.fracYi1;

        for(var i = 0; i<inputBuffer.length; i = i + 1){
          // Current input sample
          x = inputBuffer[i];

          // Calculate the output
          y = this.a1*x + xi1 - this.a1*yi1;

          // Update the memories
          xi1 = x;
          yi1 = y;
          // Save the outputBuffer
          outputBuffer[i] = y;

        }
        // Save memories
        this.fracXi1 = xi1;
        this.fracXi2 = xi2;
        this.fracYi1 = yi1;

        return outputBuffer;
      }
    },
  }; // End of object definition.

  // Instantiate an object and initialize it.
  var fractionalDelay = Object.create({}, fractionalDelayObject);
  return fractionalDelay.init(sampleRate, optMaxDelayTime);
};


// // CommonJS function export
module.exports = createFractionalDelay;
},{}]},{},[1])
(1)
});