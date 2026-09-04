'use strict';
/* 中英對照詞庫 —— 打 milk 搵到「牛奶」，打「廁紙」都搵到 toilet paper。
 *
 * 詞庫同展開邏輯而家全部住喺 public/search-core.js（server 同 iPad 靜態版共用同一份），
 * 呢度淨係做個轉接口，令舊 code（server.js 等）require 落嚟唔使改。
 * 想加詞／改評分 —— 去 public/search-core.js 改，唔好喺呢度另開一份。
 */

const core = require('./public/search-core.js');

module.exports = {
  expandQuery: core.expandQuery,
  synonyms: core.synonyms,
  POPULAR: core.POPULAR,
  hasCJK: core.hasCJK,
  TERMS: core.RAW,
};
