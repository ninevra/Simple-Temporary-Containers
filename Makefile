SOURCES=src/* src/icons/* src/icons/feather/*
TEST_SOURCES=src/test/* src/test/lib/* src/test/lib/chai/* src/test/lib/mocha/* src/test/tests/*

simple-temporary-containers.zip: ${SOURCES}
	cd src; zip -r -FS ../simple-temporary-containers.zip *

stc-test.zip: ${SOURCES} ${TEST_SOURCES}
	cd src; zip -r -FS ../stc-test.zip *
