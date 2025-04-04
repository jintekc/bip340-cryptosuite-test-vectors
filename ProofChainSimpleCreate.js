/*
    Steps to create a signed verifiable credential with a simple
    proof chain using Ed25519 signatures.
*/

import { mkdir, readFile, writeFile } from 'fs/promises';
import jsonld from 'jsonld';
import { localLoader } from './documentLoader.js';
import { base58btc } from "multiformats/bases/base58";
import {ed25519 as ed} from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, concatBytes } from '@noble/hashes/utils';
import { schnorr } from '@noble/curves/secp256k1';

// Create output directory for the results
const baseDir = "./output/bip340-chain-set-2025/";
let status = await mkdir(baseDir, {recursive: true});

jsonld.documentLoader = localLoader; // Local loader for JSON-LD

const keyPairs = JSON.parse(
  await readFile(
    new URL('./input/multiKeyPairs.json', import.meta.url)
  )
);

// Read input document from a file or just specify it right here.
let document = JSON.parse(
    await readFile(
      new URL('./input/unsigned.json', import.meta.url)
    )
  );

// Signed Document Creation Steps:

// Canonize the document
let cannon = await jsonld.canonize(document);
// console.log("Canonized unsigned document:")
// console.log(cannon);
// writeFile(baseDir + 'canonDocDataInt.txt', cannon);

// Hash canonized document
let docHash = sha256(cannon); // @noble/hash will convert string to bytes via UTF-8
// console.log("Hash of canonized document in hex:")
// console.log(bytesToHex(docHash));
// writeFile(baseDir + 'docHashDataInt.txt', bytesToHex(docHash));

const proofIds = ["urn:uuid:26329423-bec9-4b2e-88cb-a7c7d9dc4544"];

// **Proof Chains** starting from document
let signedDocument = Object.assign({}, document);
const chainKeys = [keyPairs.keyPair1, keyPairs.keyPair2];
const previousProofs = [null, proofIds[0]]; // Simple proof chain
for (let i = 0; i < chainKeys.length; i++) {
  let allProofs;
  if (Array.isArray(signedDocument.proof)) {
    allProofs = signedDocument.proof;
  } else { 
    if (signedDocument.proof === undefined) {
      allProofs = [];
    } else {
      allProofs = [signedDocument.proof];
    }
    console.log(`signedDocument.proof = ${signedDocument.proof}`)
  }
  console.log(`allProofs = ${JSON.stringify(allProofs)}`)
  // if (!allProofs) { // In case starting document doesn't have a proof
  //   allProofs = [];
  // }
  // Set up the proof configuration for the chain
  let proofConfigChain = {};
  proofConfigChain.type = "DataIntegrityProof";
  if (i !== (chainKeys.length - 1)) { // Don't need id for last item in chain
    proofConfigChain.id = proofIds[i];
  }
  proofConfigChain.cryptosuite = "bip340-rdfc-2025";
  proofConfigChain.created = `2023-02-26T22:${i}6:38Z`; // Signing later for realism ;-)
  proofConfigChain.verificationMethod = 'did:key:' + chainKeys[i].publicKeyMultibase + 
    '#' + chainKeys[i].publicKeyMultibase;

  proofConfigChain.proofPurpose = "assertionMethod";
  if (previousProofs[i]) { // If no previous proof don't set the option.
    proofConfigChain.previousProof = previousProofs[i];
  }
  writeFile(baseDir + `proofChainSimpleConfig${i+1}.json`, JSON.stringify(proofConfigChain, null, 2));
  proofConfigChain["@context"] = document["@context"];
  // Dave's algorithm update
  let matchingProofs = findMatchingProofs(previousProofs[i], allProofs);
  document.proof = matchingProofs;
  console.log(`Matching proofs for i = ${i}`);
  console.log(matchingProofs);
  // Canonize the "chained" document
  writeFile(baseDir + `proofChainSimpleTempDoc${i+1}.json`, JSON.stringify(document, null, 2));
  cannon = await jsonld.canonize(document);

  // Hash canonized chained document
  docHash = sha256(cannon); // @noble/hash will convert string to bytes via UTF-8

  // canonize the proof config
  let proofCanon = await jsonld.canonize(proofConfigChain);

  // Hash canonized proof config
  let proofHash = sha256(proofCanon); // @noble/hash will convert string to bytes via UTF-8

  // Combine hashes
  let combinedHash = concatBytes(proofHash, docHash);

  let hashData = sha256(combinedHash);

  // Sign
  let privKey = base58btc.decode(chainKeys[i].privateKeyMultibase);
  privKey = privKey.slice(2, 34); // only want the first 2-34 bytes
  // console.log(`Secret key length ${privKey.length}, value in hex:`);
  let signature = await schnorr.sign(hashData, privKey);
  proofConfigChain.proofValue = base58btc.encode(signature);
  delete proofConfigChain['@context'];
  writeFile(baseDir + `proofChainSimpleConfigSigned${i+1}.json`, JSON.stringify(proofConfigChain, null, 2));

// Construct Signed Document
  signedDocument = Object.assign({}, document);
  signedDocument.proof = allProofs.concat(proofConfigChain);

// console.log(JSON.stringify(signedDocument, null, 2));
  writeFile(baseDir + `signedProofChainSimple${i+1}.json`, JSON.stringify(signedDocument, null, 2));
}

// function to get all matching proofs (only first level no dependencies)
// prevProofs is either a string or an array
// proofs is an array of proofs
function findMatchingProofs(prevProofs, proofs) {
  console.log(`findMatch called with ${prevProofs}`);
  let matches = [];
  if (!prevProofs) { // In case of no previous proof edge case
    return matches;
  }
  if (Array.isArray(prevProofs)) {
      prevProofs.forEach(pp => {
        let matchProof = proofs.find(p => p.id === pp);
        if (!matchProof) {
          throw new Error(`Missing proof for id = ${pp}`);
        }
        matches.push(matchProof);
      })
  } else {
      let matchProof = proofs.find(p => p.id === prevProofs);
      if (!matchProof) {
        throw new Error(`Missing proof for id = ${prevProofs}`);
      }
      matches.push(matchProof);
  }
  return matches;
}
