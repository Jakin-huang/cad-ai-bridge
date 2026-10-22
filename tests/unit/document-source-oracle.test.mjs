import test from 'node:test';import assert from 'node:assert/strict';
import {sameSourceBoundValues,hasCurrentRequirementSource} from '../helpers/document-source-oracle.mjs';
test('client oracle permits renamed source aliases only when actual values and frozen source identities are preserved',()=>{
 const source={id:'DATA',sha256:'a'.repeat(64),role:'catalog',derivedFromFinalDrawing:false},renamed={...source,id:'SRC_DATA'},value={watts:24,sourceId:'DATA',nested:{sourceIds:['DATA'],voltage:230}},after={watts:24,sourceId:'SRC_DATA',nested:{sourceIds:['SRC_DATA'],voltage:230}};
 assert.equal(sameSourceBoundValues(value,after,[source],[renamed]),true);
 for(const changed of [{...renamed,sha256:'b'.repeat(64)},{...renamed,role:'brief'},{...renamed,derivedFromFinalDrawing:true}])assert.equal(sameSourceBoundValues(value,after,[source],[changed]),false);
 assert.equal(sameSourceBoundValues(value,{...after,watts:25},[source],[renamed]),false);assert.equal(sameSourceBoundValues(value,after,[source],[]),false);
 const row={sourceIds:['SRC_DATA'],status:'interpreted'};assert.equal(hasCurrentRequirementSource(row,[renamed],[source.sha256]),true);assert.equal(hasCurrentRequirementSource(row,[{...renamed,sha256:'b'.repeat(64)}],[source.sha256]),false);assert.equal(hasCurrentRequirementSource({...row,status:'assumed'},[renamed],[source.sha256]),false);assert.equal(hasCurrentRequirementSource({...row,sourceIds:['BASELINE']},[{...renamed,id:'BASELINE'}],[source.sha256]),false);
});
