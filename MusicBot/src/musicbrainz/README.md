# MusicBrainz Engine Module

This directory encapsulates all integrations with the MusicBrainz API and Cover Art Archive services for the Voxaria Audio Engine.

## Files
- `MusicBrainzClient.js`: Raw query client utilizing token-bucket rate limiting (1 rps target).
- `CoverArtResolver.js`: Manages checking and returning Cover Art Archive URLs with fallback layers (Release -> Release Group -> YouTube fallback).
