SOURCES=src/* src/icons/* src/icons/feather/*

simple-temporary-containers.zip: ${SOURCES}
	cd src; zip -r -FS ../simple-temporary-containers.zip *
