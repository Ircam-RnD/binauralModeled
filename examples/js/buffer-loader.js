!function(e){if("object"==typeof exports)module.exports=e();else if("function"==typeof define&&define.amd)define(e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.createBufferLoader=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
/**
 * @fileOverview
 * WAVE audio library module for buffer loading.
 * @author Karim Barkati, Victor Saiz, Emmanuel Fréard, Samuel Goldszmidt
 * @version 3.0.0
 */

var Promise = _dereq_("native-promise-only");

/**
 * Function invocation pattern for object creation.
 * @public
 */
var createBufferLoader = function createBufferLoader() {
  'use strict';
  // Ensure global availability of an "audioContext" instance of web audio AudioContext.
  window.audioContext = window.audioContext || new AudioContext() || new webkitAudioContext();

  /**
   * ECMAScript5 property descriptors object.
   */
  var bufferLoaderObject = {

    /**
     * Main wrapper function for audio buffer loading.
     * Switch between loadBuffer and loadAll.
     * @public
     * @param fileURLs The URL(s) of the audio files to load. Accepts a URL to the audio file location or an array of URLs.
     */
    load: {
      enumerable: true,
      value: function(fileURLs) {
        if (Array.isArray(fileURLs)) {
          return this.loadAll(fileURLs);
        } else {
          return this.loadBuffer(fileURLs);
        }
      }
    },

    /**
     * Load a single audio file,
     * decode it in an AudioBuffer, return a Promise
     * @public
     * @param fileURL The URL of the audio file location to load.
     */
    loadBuffer: {
      enumerable: true,
      value: function(fileURL) {
        return this.fileLoadingRequest(fileURL)
          .then(
            this.decodeAudioData,
            function(error) {
              throw error;
            });
      }
    },

    /**
     * Load all audio files at once in a single array,
     * decode them in an array of AudioBuffers,
     * and return a Promise
     * @public
     * @param fileURLs The URLs array of the audio files to load.
     */
    loadAll: {
      enumerable: true,
      value: function(fileURLs) {
        var urlsCount = fileURLs.length;
        var promises = [];
        var that = this;

        for (var i = 0; i < urlsCount; ++i) {
          promises.push(this.fileLoadingRequest(fileURLs[i], i));
        }

        return Promise.all(promises)
          .then(
            function get_all_the_things(arraybuffers) {
              return Promise.all(arraybuffers.map(function(arraybuffer) {
                return that.decodeAudioData(arraybuffer);
              }));
            },
            function(error) {
              throw error; // TODO: better error handler
            }
          );
      }
    },

    /**
     * Load a file asynchronously, return a Promise.
     * @private
     * @param url The URL of the audio file to load.
     */
    fileLoadingRequest: {
      enumerable: false,
      value: function(url, index) {
        var self = this;
        var promise = new Promise(function(resolve, reject) {
          // Load buffer asynchronously
          var request = new XMLHttpRequest();
          var that = this;

          request.open('GET', url, true);
          request.responseType = "arraybuffer";
          request.onload = function() {
            // Test request.status value, as 404 will also get there
            if (request.status === 200 || request.status === 304) {
              resolve(request.response);
            } else {
              reject(new Error(request.statusText));
            }
          };
          request.onprogress = function(evt) {
            if(self.progressCallback){
              if(index !== undefined){
                self.progressCallback({index: index, value: evt.loaded / evt.total});
              }else{
                self.progressCallback(evt.loaded / evt.total);
              }
            }
          };
          // Manage network errors
          request.onerror = function() {
            reject(new Error("Network Error"));
          };
          request.send();
        });
        return promise;
      }
    },

    /**
     * Decode Audio Data, return a Promise
     * @private
     * @param arraybuffer The arraybuffer of the loaded audio file to be decoded.
     */
    decodeAudioData: {
      enumerable: false,
      value: function(arraybuffer) {
        var promise = new Promise(function(resolve, reject) {
          window.audioContext.decodeAudioData(
            arraybuffer, // returned audio data array
            function successCallback(buffer) {
              resolve(buffer);
            },
            function errorCallback(error) {
              reject(new Error("DecodeAudioData error"));
            }
          );
        });
        return promise;
      }
    },
    /**
     * Set the callback function to get the progress of file loading process.
     * This is only for the file loading progress as decodeAudioData doesn't
     * expose a decode progress value.
     * @public
     */
    progressCallback: {
      get: function(){ return this.progressCb; },
      set: function(value){ this.progressCb = value; },
    },

  };
  // Instantiate an object.
  var instance = Object.create({progressCb: undefined}, bufferLoaderObject);
  return instance;
};


// CommonJS function export
module.exports = createBufferLoader;

},{"native-promise-only":2}],2:[function(_dereq_,module,exports){
(function (global){
/*! Native Promise Only
    v0.4.1-g (c) Kyle Simpson
    MIT License: http://getify.mit-license.org
*/
!function(t,n,e){n[t]=n[t]||e(),"undefined"!=typeof module&&module.exports?module.exports=n[t]:"function"==typeof define&&define.amd&&define(function(){return n[t]})}("Promise","undefined"!=typeof global?global:this,function(){"use strict";function t(){function t(t,n){this.fn=t,this.self=n,this.next=void 0}var n,e,r;return{add:function(o,i){r=new t(o,i),e?e.next=r:n=r,e=r,r=void 0},drain:function(){var t=n;for(n=e=d=null;t;)t.fn.call(t.self),t=t.next}}}function n(t,n){y?(y=!1,t.call(n)):(p.add(t,n),d||(d=g(p.drain)))}function e(t){var n,e=typeof t;return null===t||"object"!==e&&"function"!==e||(n=t.then),"function"==typeof n?n:!1}function r(){var t,n,e,r=this;if(0===r.state)return y=!1;for(e=0;e<r.chain.length;e++)n=r.chain[e],t=1===r.state?n.success:n.failure,o(r,t,n);r.chain.length=0}function o(t,n,r){var o,i;try{n===!1?(y=!0,r.reject(t.msg)):(o=n===!0?t.msg:n.call(void 0,t.msg),y=!0,o===r.promise?r.reject(TypeError("Promise-chain cycle")):(i=e(o))?i.call(o,r.resolve,r.reject):r.resolve(o))}catch(c){y=!0,r.reject(c)}}function i(t){if(t.def){if(t.triggered)return y=!1;t.triggered=!0,t=t.def}return 0!==t.state?y=!1:t}function c(t){var o,u,a=i(this);if(a!==!1)try{(o=e(t))?(u=new s(a),o.call(t,function(){c.apply(u,arguments)},function(){f.apply(u,arguments)})):(a.msg=t,a.state=1,n(r,a))}catch(l){f.call(u||new s(a),l)}}function f(t){var e=i(this);e!==!1&&(e.msg=t,e.state=2,n(r,e))}function u(t,n){y=!0,t(n)}function a(t,n,e,r){for(var o=0;o<n.length;o++)!function(o){t.resolve(n[o]).then(function(t){e(o,t)},r)}(o)}function s(t){this.def=t,this.triggered=!1}function l(t){this.promise=t,this.state=0,this.triggered=!1,this.chain=[],this.msg=void 0}function h(t){if("function"!=typeof t)throw TypeError("Not a function");var e=this,o=new l(e);e.then=function(t,e){var i={success:"function"==typeof t?t:!0,failure:"function"==typeof e?e:!1};return i.promise=new this.constructor(function(t,n){if("function"!=typeof(t&&n))throw TypeError("Not a function");i.resolve=t,i.reject=n}),o.chain.push(i),n(r,o),i.promise},e["catch"]=function(t){return o.promise.then.call(this,void 0,t)};try{t.call(void 0,function(t){return o.triggered?void(y=!1):(o.triggered=!0,void c.call(o,t))},function(t){return o.triggered?void(y=!1):(o.triggered=!0,void f.call(o,t))})}catch(i){f.call(o,i)}}var d,p,y=!1,g="undefined"!=typeof setImmediate?function(t){return setImmediate(t)}:setTimeout,v=Object.defineProperty?function(t,n,e,r){return Object.defineProperty(t,n,{value:e,writable:!0,configurable:r!==!1})}:function(t,n,e){return t[n]=e,t};return p=t(),v(h,"prototype",v({},"constructor",h),!1),v(h,"resolve",function(t){var e=this;return"object"==typeof t&&t instanceof e?t:new e(function(e,r){if("function"!=typeof(e&&r))throw TypeError("Not a function");n(function(){u(e,t)})})}),v(h,"reject",function(t){return new this(function(n,e){if("function"!=typeof(n&&e))throw TypeError("Not a function");e(t)})}),v(h,"all",function(t){var n=this;return Array.isArray(t)?0===t.length?n.resolve([]):new n(function(e,r){if("function"!=typeof(e&&r))throw TypeError("Not a function");var o=t.length,i=Array(o),c=0;a(n,t,function(t,n){i[t]=n,++c===o&&u(e,i)},r)}):n.reject(TypeError("Not an array"))}),v(h,"race",function(t){var n=this;return Array.isArray(t)?new n(function(e,r){if("function"!=typeof(e&&r))throw TypeError("Not a function");a(n,t,function(t,n){u(e,n)},r)}):n.reject(TypeError("Not an array"))}),h});

}).call(this,typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}]},{},[1])
(1)
});