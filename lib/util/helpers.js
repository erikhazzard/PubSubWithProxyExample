"use strict";
/**
 *
 * Various small helper functions
 *
 * @module lib/util/helpers.js
 */
var d3 = require('d3');

/**
 * Comma formatter. Minor extra optimization to avoid redundant d3.format calls
 * @param {String} input - target input string
 * @returns {String} Formatted string with commas
 */
const _d3FormatComma = d3.format(',');
module.exports.formatComma = (input) => { return _d3FormatComma(input); };

/**
 *
 * Calculates a string's "size" by turning the string into a strictly
 * alpha-numeric string and calling parseInt('', 36) on each character
 *
 * @param {String} targetString - calculate size of this string
 * @returns {Number} String size
 */
module.exports.getStringSize = (targetString) => {
    let size = 0;
    targetString = (targetString + '').toLowerCase();

    // remove any non alpha-numeric characters
    targetString = targetString.replace(/[^a-zA-Z0-9]/g, '');

    for (let i = targetString.length - 1; i >= 0; i--) {
        size += parseInt(targetString[i], 36);
    }

    if (isNaN(size)) { size = targetString.length; }

    return size;
};
