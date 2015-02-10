/**
 * @fileOverview
 *
 * @author Arnau Julià <Arnau.Julia@gmail.com>
 * @version 0.1.0
 */
var kdt = require('kdt');
var audioContext = require("audio-context");
var BiquadFilter = require("biquad-filter");
var FractionalDelay = require("fractional-delay");

/**
 * @class BinauralModeled
 */
class BinauralModeled {

    /**
     * Mandatory initialization method.
     * @public
     * @chainable
     */
    constructor() {
        // Private properties
        this.hrtfDataset = undefined;
        this.hrtfDatasetLength = undefined;
        this.nextPosition = [];
        this.changeWhenFinishCrossfading = false;
        this.position = []
        this.crossfadeDuration = 20 / 1000
        this.bufferSize = 1024;
        this.tree = -1;

        this.input = audioContext.createGain();

        // Two sub audio graphs creation:
        // - mainConvolver which represents the current state
        // - and secondaryConvolver which represents the potential target state
        //   when moving sound to a new position

        this.mainAudioGraph = new ProcessingAudioGraph();
        this.mainAudioGraph.gain.value = 1;
        this.input.connect(this.mainAudioGraph.input);

        this.secondaryAudioGraph = new ProcessingAudioGraph();
        this.secondaryAudioGraph.gain.value = 0;
        this.input.connect(this.secondaryAudioGraph.input);
        // Web Audio
        this.sampleRate = audioContext.sampleRate;
        //Connections
        this.input.connect(this.mainAudioGraph.input);
        this.input.connect(this.secondaryAudioGraph.input);
    }


    /**
     * Connects the binauralModeledNode to the Web Audio graph
     * @public
     * @chainable
     * @param node Destination node
     */
    connect(node) {
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
    disconnect(node) {
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
    set HRTFDataset(hrtfDataset) {
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
    }
    get HRTFDataset() {
        return this.hrtfDataset;
    }


    /**
     * Calculate the distance between two points in a 3-D space.
     * @private
     * @chainable
     * @param a Object containing three properties: x, y, z
     * @param b Object containing three properties: x, y, z
     */
    distance(a, b) {
        // No need to compute square root here for distance comparison, this is more eficient.
        return Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + Math.pow(a.z - b.z, 2);
    }

    /**
     * Set gain value and squared volume.
     * @private
     * @chainable
     * @todo : realment va aquí això?
     */
    setLastPosition() {
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
    crossfading() {
        // Do the crossfading between mainAudioGraph and secondaryAudioGraph
        var now = audioContext.currentTime;
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
    setPosition(azimuth, elevation, distance) {

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
    reallyStartPosition() {
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
    getPosition() {
        return this.position;
    }


    /**
     * Pause playing.
     * @public
     */
    setCrossfadeDuration(msRamp) {
        //save in seconds
        this.crossfadeDuration = msRamp / 1000;
    }

    /**
     * Seek buffer position (in sec).
     * @public
     */
    getCrossfadeDuration() {
        //return in ms
        return crossfadeDuration * 1000;
    }


    /**
     * Release playing flag when the end of the buffer is reached.
     * @public
     * @todo Handle speed changes.
     */
    isCrossfading() {
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
    getHRTF(azimuth, elevation, distance) {
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
    sphericalToCartesian(azimuth, elevation, distance) {
        return {
            x: distance * Math.sin(azimuth),
            y: distance * Math.cos(azimuth),
            z: distance * Math.sin(elevation)
        }
    }


    /**
     * Get the nearest position for an input position.
     * @private
     * @param azimuth Azimuth in degrees (°): from 0 to -180 for source on your left, and from 0 to 180 for source on your right
     * @param elevation Elevation in degrees (°): from 0 to 90 for source above your head, 0 for source in front of your head, and from 0 to -90 for source below your head)
     * @param distance Distance in meters
     */
    getRealCoordinates(azimuth, elevation, distance) {
        var nearest = this.getNearestPoint(azimuth, elevation, distance);
        // Return azimuth, elevation and distance of nearest position for the input values
        return {
            azimuth: nearest.azimuth,
            elevation: nearest.elevation,
            distance: nearest.distance
        }
    }

    /**
     * Get the nearest position for an input position.
     * @private
     * @param azimuth Azimuth in degrees (°): from 0 to -180 for source on your left, and from 0 to 180 for source on your right
     * @param elevation Elevation in degrees (°): from 0 to 90 for source above your head, 0 for source in front of your head, and from 0 to -90 for source below your head)
     * @param distance Distance in meters
     */
    getNearestPoint(azimuth, elevation, distance) {
        // Degrees to radians for the azimuth and elevation
        var azimuthRadians = azimuth * Math.PI / 180;
        var elevationRadians = elevation * Math.PI / 180;
        // Convert spherical coordinates to cartesian
        var cartesianCoord = this.sphericalToCartesian(azimuthRadians, elevationRadians, distance);
        // Get the nearest HRTF file for the desired position
        var nearest = this.tree.nearest(cartesianCoord, 1)[0];

        return nearest[0];
    }


};

/**
 * AudioGraph sub audio graph object as an ECMAScript5 properties object.
 */

class ProcessingAudioGraph {


    constructor() {
        // Private properties
        this.bufferSize = 1024;

        // Creations
        this.input = audioContext.createGain();
        this.gainNode = audioContext.createGain();
        this.biquadFilterLeft = new BiquadFilter();
        this.biquadFilterRight = new BiquadFilter();
        this.fractionalDelayLeft = new FractionalDelay(44100);
        this.fractionalDelayRight = new FractionalDelay(44100);
        this.processorNode = audioContext.createScriptProcessor(this.bufferSize);
        // Connections
        this.input.connect(this.processorNode);
        this.processorNode.connect(this.gainNode);
        // Start processorNode
        this.processorNodeFunction();
    }

    get gain() {
        return this.gainNode.gain;
    }

    /**
     * Set coefficients biquad filter
     * @public
     * @param value AudioBuffer Object.
     */
    setCoefficients(leftCoefficients, rightCoefficients) {
        this.biquadFilterLeft.setCoefficients(leftCoefficients);
        this.biquadFilterRight.setCoefficients(rightCoefficients);
    }

    /**
     * Set buffer and bufferDuration.
     * @public
     * @chainable
     */
    setDelay(delay) {
        var delayLeft = 1 / 1000 + delay / 2;
        var delayRight = 1 / 1000 - delay / 2;
        this.fractionalDelayLeft.setDelay(delayLeft);
        this.fractionalDelayRight.setDelay(delayRight);
    }


    processorNodeFunction() {
        var that = this;
        this.processorNode.onaudioprocess = function(e) {
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
        }
    }

    /**
     * Connect the convolverAudioGraph to a node
     * @public
     * @chainable
     * @param node Destination node
     */
    connect(node) {
        this.gainNode.connect(node);
        return this;
    }

    /**
     * Disconnect the convolverAudioGraph to a node
     * @public
     * @chainable
     * @param node Destination node
     */
    disconnect(node) {
        this.gainNode.disconnect(node);
        return this;
    }


}

module.exports = BinauralModeled;
