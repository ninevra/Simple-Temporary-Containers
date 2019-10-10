SOURCES=src/* src/icons/* src/icons/feather/*
TEST_SOURCES=src/test/* src/test/lib/* src/test/lib/chai/* src/test/lib/mocha/* src/test/tests/*

bin/simple-temporary-containers.zip: ${SOURCES} | bin
	cd src; zip -r -FS ../bin/simple-temporary-containers.zip *

bin/stc-test.zip: ${SOURCES} ${TEST_SOURCES} | bin
	cd src; zip -r -FS ../bin/stc-test.zip *

bin:
	mkdir bin
