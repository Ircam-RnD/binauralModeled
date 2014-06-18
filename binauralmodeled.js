!function(e){if("object"==typeof exports)module.exports=e();else if("function"==typeof define&&define.amd)define(e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.createBinauralModeled=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
/**
 * @fileOverview
 * 
 * @author Arnau Julià <Arnau.Julia@gmail.com>
 * @version 0.1.0
 */

var kdt = _dereq_('kdt');
var biquadFilter = _dereq_("./libs/biquad-filter.js");
var fractionalDelay = _dereq_("./libs/fractional-delay.js");

/**
 * Function invocation pattern for a simple player.
 * @public
 */
var createBinauralModeled = function createBinauralModeled() {
  'use strict';

  // Ensure global availability of an "audioContext" instance of web audio AudioContext.
  window.audioContext = window.audioContext || new AudioContext() || new webkitAudioContext();

  /**
   * BinauralModeled object as an ECMAScript5 properties object.
   */
  var binauralModeledObject = {

    // Private properties
    context: {
      writable: true
    },
    hrtfDataset: {
      writable: true
    },
    hrtfDatasetLength: {
      writable: true
    },
    nextPosition: {
      writable: true,
      value: []
    },
    changeWhenFinishCrossfading: {
      writable: true,
      value: false
    },
    intervalID: {
      writable: true,
    },
    position: {
      writable: true,
      value: []
    },
    crossfadeDuration: {
      writable: true,
      value: 20/1000
    },
    bufferSize: {
      writable: true,
      value: 1024
    },
    sampleRate: {
      writable: true,
    },
    input: {
      writable: true,
    },
    tree: {
      writable: true,
      value: -1
    },
    mainAudioGraph: {
      writable: true
    },
    secondaryAudioGraph: {
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
      this.input = audioContext.createGain();

      // Two sub audio graphs creation:
      // - mainConvolver which represents the current state
      // - and secondaryConvolver which represents the potential target state
      //   when moving sound to a new position

      this.mainAudioGraph = Object.create({}, processingAudioGraph);
      this.mainAudioGraph.init();
      this.mainAudioGraph.gain.value = 1;
      this.input.connect(this.mainAudioGraph.input);

      this.secondaryAudioGraph = Object.create({}, processingAudioGraph);
      this.secondaryAudioGraph.init();
      this.secondaryAudioGraph.gain.value = 0;
      this.input.connect(this.secondaryAudioGraph.input);
      // Web Audio
      this.sampleRate = audioContext.sampleRate;
      //Connections
      this.input.connect(this.mainAudioGraph.input);
      this.input.connect(this.secondaryAudioGraph.input);

      return this; // For chainability
      }
    },

    /**
     * Connects the binauralModeledNode to the Web Audio graph
     * @public
     * @chainable
     * @param node Destination node
     */
    connect: {
      enumerable: true,
      value: function(node) {
        this.mainAudioGraph.connect(node);
        this.secondaryAudioGraph.connect(node);
        return this;  // For chainability
      }
    },

    /**
     * Disconnect the binauralModeledNode from the Web Audio graph
     * @public
     * @chainable
     * @param node Destination node
     */
    disconnect: {
      enumerable: true,
      value: function(node) {
        this.mainAudioGraph.disconnect(node);
        this.secondaryAudioGraph.disconnect(node);
        return this; // For chainability
      }
    },

    /**
     * Set HRTF Dataset to be used with the virtual source.
     * @public
     * @chainable
     * @param hrtfDataset Array of Objects containing the azimuth, distance, elevation, url and buffer for each point
     */
    HRTFDataset: {
      enumerable : true,
      configurable : true,
      set: function(hrtfDataset){
        this.hrtfDataset = hrtfDataset;
        this.hrtfDatasetLength = this.hrtfDataset.length;

        for(var i=0; i<this.hrtfDatasetLength; i++){
          var hrtf = this.hrtfDataset[i];
          // Azimuth and elevation to radians
          var azimuthRadians = hrtf.azimuth*Math.PI/180;
          var elevationRadians = hrtf.elevation*Math.PI/180;
          var catesianCoord = this.sphericalToCartesian(azimuthRadians, elevationRadians, hrtf.distance);
          hrtf.x = catesianCoord.x;
          hrtf.y = catesianCoord.y;
          hrtf.z = catesianCoord.z;
        }
        this.tree = kdt.createKdTree(this.hrtfDataset, this.distance, ['x', 'y', 'z']);

        // Put default values
        var hrtfNextPosition = this.getHRTF(0, 0, 1);
        this.secondaryAudioGraph.setCoefficients(hrtfNextPosition.iir_coeffs_left, hrtfNextPosition.iir_coeffs_right);
        this.secondaryAudioGraph.setDelay(hrtfNextPosition.itd/1000);
        this.mainAudioGraph.setCoefficients(hrtfNextPosition.iir_coeffs_left, hrtfNextPosition.iir_coeffs_right);
        this.mainAudioGraph.setDelay(hrtfNextPosition.itd/1000);
      },
      get: function(){
        return this.hrtfDataset;
      }
    },

    /**
     * Calculate the distance between two points in a 3-D space.
     * @private
     * @chainable
     * @param a Object containing three properties: x, y, z
     * @param b Object containing three properties: x, y, z
     */
    distance: {
      enumerable: false,
      value: function(a, b){
        // No need to compute square root here for distance comparison, this is more eficient.
        return Math.pow(a.x - b.x, 2) +  Math.pow(a.y - b.y, 2) +  Math.pow(a.z - b.z, 2);
      }
    },

    /**
     * Set gain value and squared volume.
     * @private
     * @chainable
     * @todo : realment va aquí això?
     */
    setLastPosition: {
      enumerable: false,
      value: function() {
        if(!this.isCrossfading()){
          this.changeWhenFinishCrossfading = false;
          clearInterval(this.intervalID);
          this.reallyStartPosition();          
        }
      }
    },

    /**
     * Crossfading
     * @private
     * @chainable
     */
    crossfading: {
      enumerable: false,
      value: function() {
        // Do the crossfading between mainAudioGraph and secondaryAudioGraph
        var now = audioContext.currentTime;
        // Wait two buffers until do the change (scriptProcessorNode only update the variables at the first sample of the buffer)
        this.mainAudioGraph.gain.setValueAtTime(1, now+2*this.bufferSize/this.sampleRate);
        this.mainAudioGraph.gain.linearRampToValueAtTime(0, now+this.crossfadeDuration + 2*this.bufferSize/this.sampleRate);

        this.secondaryAudioGraph.gain.setValueAtTime(0, now+ 2*this.bufferSize/this.sampleRate);
        this.secondaryAudioGraph.gain.linearRampToValueAtTime(1, now+this.crossfadeDuration + 2*this.bufferSize/this.sampleRate);   
      }
    },

    /**
     * Set position of the virtual source
     * @public
     * @chainable
     * @param azimuth Azimuth in degrees (°): from 0 to -180 for source on your left, and from 0 to 180 for source on your right
     * @param elevation Elevation in degrees (°): from 0 to 90 for source above your head, 0 for source in front of your head, and from 0 to -90 for source below your head)
     * @param distance Distance in meters
     */
     setPosition: {
      enumerable: true,
      value: function(azimuth, elevation, distance) {

        if (arguments.length === 3) {
          // Calculate the nearest position for the input azimuth, elevation and distance
          var nearestPosition = this.getRealCoordinates(azimuth, elevation, distance);
          // No need to change the current HRTF loaded if setted position equal current position
          if (nearestPosition.azimuth !== this.position.azimuth || nearestPosition.elevation !== this.position.elevation || nearestPosition.distance !== this.position.distance ) {
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
    },

    /**
     * Really change the position
     * @private
     */
    reallyStartPosition: {
      enumerable: false,
      value: function() {
        // Save the current position
        this.position.azimuth = this.nextPosition.azimuth;
        this.position.elevation = this.nextPosition.elevation;
        this.position.distance = this.nextPosition.distance;

        var hrtfNextPosition = this.getHRTF(this.position.azimuth, this.position.elevation, this.position.distance);
        // Load the new position in the biquad and delay not active (secondaryAudioGraph)
        this.secondaryAudioGraph.setCoefficients(hrtfNextPosition.iir_coeffs_left, hrtfNextPosition.iir_coeffs_right);
        this.secondaryAudioGraph.setDelay(hrtfNextPosition.itd/1000);

        // Do the crossfading between mainAudioGraph and secondaryAudioGraph
        this.crossfading();

        // Change current mainAudioGraph
        var active = this.mainAudioGraph;
        this.mainAudioGraph = this.secondaryAudioGraph;
        this.secondaryAudioGraph = active;

      }
    },

    /**
     * Get the current position of the virtual source.
     * @public
     */
    getPosition: {
      enumerable: true,
      value: function() { 
        return this.position;
      }
    },

    /**
     * Pause playing.
     * @public
     */
    setCrossfadeDuration: {
      enumerable: true,
      value: function(msRamp) {
        //save in seconds
        this.crossfadeDuration = msRamp/1000;
      }
    },

    /**
     * Seek buffer position (in sec).
     * @public
     */
    getCrossfadeDuration: {
      enumerable: true,
      value: function() {
        //return in ms
        return crossfadeDuration*1000;
      }
    },

    /**
     * Release playing flag when the end of the buffer is reached.
     * @public
     * @todo Handle speed changes.
     */
    isCrossfading: {
      enumerable: true,
      value: function() {
        // The ramps are not finished, so the crossfading is not finished
        if(this.mainAudioGraph.gain.value !== 1){
          return true;
        }else{
          return false;
        }
      }
    },

    /**
     * Get the HRTF file for an especific position
     * @private
     * @param azimuth Azimuth in degrees (°): from 0 to -180 for source on your left, and from 0 to 180 for source on your right
     * @param elevation Elevation in degrees (°): from 0 to 90 for source above your head, 0 for source in front of your head, and from 0 to -90 for source below your head)
     * @param distance Distance in meters
     */
    getHRTF: {
      enumerable: false,
      value: function(azimuth, elevation, distance){
        var nearest = this.getNearestPoint(azimuth, elevation, distance);
        var hrtf = [];
        hrtf.iir_coeffs_left = nearest.iir_coeffs_left;
        hrtf.iir_coeffs_right = nearest.iir_coeffs_right;
        hrtf.itd = nearest.itd;

        // Return hrtf data of nearest position for the input values
        return hrtf;
      }
    },

    /**
     * Transform the spherical to cartesian coordinates.
     * @private
     * @param azimuth Azimuth in radians
     * @param elevation Elevation in radians
     * @param distance Distance in meters
     */
    sphericalToCartesian: {
      enumerable: false,
      value: function(azimuth, elevation, distance){
        return {
          x: distance*Math.sin(azimuth),
          y: distance*Math.cos(azimuth),
          z: distance*Math.sin(elevation)
        }
      }
    },

    /**
     * Get the nearest position for an input position.
     * @private
     * @param azimuth Azimuth in degrees (°): from 0 to -180 for source on your left, and from 0 to 180 for source on your right
     * @param elevation Elevation in degrees (°): from 0 to 90 for source above your head, 0 for source in front of your head, and from 0 to -90 for source below your head)
     * @param distance Distance in meters
     */
    getRealCoordinates: {
      enumerable: false,
      value: function(azimuth, elevation, distance){
        var nearest = this.getNearestPoint(azimuth, elevation, distance);
        // Return azimuth, elevation and distance of nearest position for the input values
        return {
          azimuth: nearest.azimuth,
          elevation: nearest.elevation,
          distance: nearest.distance
        }
      }
    },

    /**
     * Get the nearest position for an input position.
     * @private
     * @param azimuth Azimuth in degrees (°): from 0 to -180 for source on your left, and from 0 to 180 for source on your right
     * @param elevation Elevation in degrees (°): from 0 to 90 for source above your head, 0 for source in front of your head, and from 0 to -90 for source below your head)
     * @param distance Distance in meters
     */
    getNearestPoint: {
      enumerable: false,
      value: function(azimuth, elevation, distance) {
        // Degrees to radians for the azimuth and elevation
        var azimuthRadians = azimuth*Math.PI/180;
        var elevationRadians = elevation*Math.PI/180;
        // Convert spherical coordinates to cartesian 
        var cartesianCoord = this.sphericalToCartesian(azimuthRadians, elevationRadians, distance);
        // Get the nearest HRTF file for the desired position
        var nearest = this.tree.nearest(cartesianCoord, 1)[0];

        return nearest[0];
      }
    },

  };

   /**
   * AudioGraph sub audio graph object as an ECMAScript5 properties object.
   */

  var processingAudioGraph = {

    // Private properties
    biquadFilterLeft: {
      writable: true
    },
    biquadFilterRight: {
      writable: true
    },
    fractionalDelayLeft: {
      writable: true
    },
    fractionalDelayRight: {
      writable: true
    },
    gainNode: {
      writable: true
    },
    input: {
      writable: true
    },
    processorNode: {
      writable: true
    },
    bufferSize : {
      writable: true,
      value: 1024
    },

    /**
     * Mandatory initialization method.
     * @public
     * @chainable
     */
    init: {
      enumerable: true,
      value: function() {
        // Creations
        this.input = audioContext.createGain();
        this.gainNode = audioContext.createGain();
        this.biquadFilterLeft = biquadFilter();
        this.biquadFilterRight = biquadFilter();
        this.fractionalDelayLeft = fractionalDelay(44100);
        this.fractionalDelayRight = fractionalDelay(44100);
        this.processorNode = audioContext.createScriptProcessor(this.bufferSize);
        // Connections
        this.input.connect(this.processorNode);
        this.processorNode.connect(this.gainNode);
        // Start processorNode
        this.processorNodeFunction();

        return this;
      }
    },

    gain: {
      enumerable : true,
      get: function(){
        return this.gainNode.gain;
      }
    },

    /**
     * Set coefficients biquad filter
     * @public
     * @param value AudioBuffer Object.
     */
    setCoefficients: {
      enumerable: false,
      value: function(leftCoefficients, rightCoefficients) {
        this.biquadFilterLeft.setCoefficients(leftCoefficients);
        this.biquadFilterRight.setCoefficients(rightCoefficients);
      }
    },

    /**
     * Set buffer and bufferDuration.
     * @public
     * @chainable
     */
    setDelay: {
      enumerable: false,
      value: function(delay) {
        var delayLeft = 1/1000 + delay/2;
        var delayRight = 1/1000 - delay/2;
        this.fractionalDelayLeft.setDelay(delayLeft);
        this.fractionalDelayRight.setDelay(delayRight);
      }
    },

    processorNodeFunction: {
      enumerable : false,
      configurable: true,
      value: function(){
        var that = this;
        this.processorNode.onaudioprocess = function(e){
          // Get the inputBuffer
          var inputArray = e.inputBuffer.getChannelData(0);

          // Get the outputBuffers
          var leftOutputArray = e.outputBuffer.getChannelData(0);
          var rightOutputArray = e.outputBuffer.getChannelData(1);

          //Delay
          var mediumArrayLeft = new Float32Array(that.fractionalDelayLeft.process(inputArray));
          var mediumArrayRight = new Float32Array(that.fractionalDelayRight.process(inputArray));

          //BiquadFilter
          that.biquadFilterLeft.process(mediumArrayLeft, leftOutputArray);
          that.biquadFilterRight.process(mediumArrayRight, rightOutputArray);
        }
      }
    },

    /**
     * Connect the convolverAudioGraph to a node
     * @public
     * @chainable
     * @param node Destination node
     */
    connect: {
      enumerable: true,
      value: function(node) {
        this.gainNode.connect(node);
        return this;
      }
    },

    /**
     * Disconnect the convolverAudioGraph to a node
     * @public
     * @chainable
     * @param node Destination node
     */
    disconnect: {
      enumerable: true,
      value: function(node){
        this.gainNode.disconnect(node);
        return this;
      }
    }

  };

  // Instantiate an object.
  var binauralModeled = Object.create({}, binauralModeledObject);
  return binauralModeled.init();
};


// CommonJS function export
module.exports = createBinauralModeled;
},{"./libs/biquad-filter.js":2,"./libs/fractional-delay.js":3,"kdt":4}],2:[function(_dereq_,module,exports){
(function (global){
!function(e){if("object"==typeof exports)module.exports=e();else if("function"==typeof define&&define.amd)define(e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.createBiquadFilter=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof _dereq_=="function"&&_dereq_;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof _dereq_=="function"&&_dereq_;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
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
}).call(this,typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],3:[function(_dereq_,module,exports){
(function (global){
!function(e){if("object"==typeof exports)module.exports=e();else if("function"==typeof define&&define.amd)define(e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.createFractionalDelay=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof _dereq_=="function"&&_dereq_;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof _dereq_=="function"&&_dereq_;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
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
(1)
});