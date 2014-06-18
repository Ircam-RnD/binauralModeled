!function(e){if("object"==typeof exports)module.exports=e();else if("function"==typeof define&&define.amd)define(e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.createBiquadFilter=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
/**
 * @fileoverview Biquad Filter library
 * @author Arnau.Julia@gmail.com
 * @version 0.1.0
 */


/**
 * Function invocation pattern for object creation.
 * @public
 */

var createBiquadFilter = function createBiquadFilter() {
  'use strict';

  /**
   * ECMAScript5 property descriptors object.
   */

  var biquadFilterObject = {

    // Properties with default values
    coefficients: { 
      writable: true,
      value: []
    },
    memories: {
      writable: true,
      value: []
    },
    numberOfCascade: {
      writable: true,
      value: 1
    },
 
    // Other properties
    context: {
      writable: true
    },

    /**
     * Mandatory initialization method.
     * @public
     * @chainable
     */
    init: {
      enumerable: true,
      value: function() {
        this.resetMemories();
        return this; // for chainability
      }
    },

    /**
     * Set biquad filter coefficients 
     * @public
     * @param coef Array of biquad coefficients in the following order: gain, firstBiquad b1, firstBiquad b2, firstBiquad a1, firstBiquad a2, secondBiquad b1, secondBIquad b2, etc.
     */
    setCoefficients: {
      enumerable: true,
      value: function(coef) {
        if (coef) {
          // If there is not a number of biquads, we consider that there is only 1 biquad.
          this.numberOfCascade = this.getNumberOfCascadeFilters(coef);
          // Reset coefficients
          this.coefficients = [];
          // Global gain
          this.coefficients.g = coef[0];
          for(var i = 0; i < this.numberOfCascade ; i = i + 1){
            this.coefficients[i] = {};
            // Four coefficients for each biquad
            this.coefficients[i].b1 = coef[1 + i*4];
            this.coefficients[i].b2 = coef[2 + i*4];
            this.coefficients[i].a1 = coef[3 + i*4];
            this.coefficients[i].a2 = coef[4 + i*4];
          }
          // Need to reset the memories after change the coefficients 
          this.resetMemories();
          return true;
        } else {
          console.error("No coefficients are set");
          return false;
        }
      }
    },

    /**
     * Get number of cascade filters
     * @private
     */
    getNumberOfCascadeFilters: {
      enumerable: false,
      value: function(coef) {
        var numberOfCascade = (coef.length - 1)/4;
        return numberOfCascade;
      }
    },

    /**
     * Reset memories of biquad filters.
     * @public
     */
    resetMemories: {
      enumerable: true,
      value: function() {
        this.memories = [];
        this.memories[0] = {};
        this.memories[0].xi1 = 0;
        this.memories[0].xi2 = 0;
        this.memories[0].yi1 = 0;
        this.memories[0].yi2 = 0;

        for(var i = 1; i < this.numberOfCascade; i = i +1){
          this.memories[i] = {};
          this.memories[i].yi1 = 0;
          this.memories[i].yi2 = 0;
        }
      }
    },

    /**
     * Calculate the output of the cascade of biquad filters for an inputBuffer.
     * @public
     * @param inputBuffer Array of the same length of outputBuffer
     * @param outputBuffer Array of the same length of inputBuffer
     */
    process: {
      enumerable: true,
      value: function(inputBuffer, outputBuffer) {
        var x;
        var y = []
        var b1, b2, a1, a2;
        var xi1, xi2, yi1, yi2, y1i1, y1i2;

        for(var i = 0; i < inputBuffer.length; i = i+1) {
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

          for(var e = 1; e < this.numberOfCascade; e = e + 1) {
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

          for(var p = 0; p < this.numberOfCascade; p = p +1){
            this.memories[p].yi2 = this.memories[p].yi1;
            this.memories[p].yi1 = y[p];
          }
        }
      }
    },

  }; // End of object definition.


  // Instantiate an object and initialize it.
  var biquadFilter = Object.create({}, biquadFilterObject);
  return biquadFilter.init();
};


// // CommonJS function export
module.exports = createBiquadFilter;
},{}]},{},[1])
(1)
});