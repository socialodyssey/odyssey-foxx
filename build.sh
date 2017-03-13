#!/bin/bash
while inotifywait -e close_write ./src/*; do zip -r graph-ops.zip src; done
