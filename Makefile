SOURCES=src/* src/icons/* src/icons/feather/*
TEST_SOURCES=src/test/* src/test/lib/* src/test/lib/chai/* src/test/lib/mocha/* src/test/tests/*

compile: bin/simple-temporary-containers.zip

test: bin/stc-test.zip

bin/simple-temporary-containers.zip: ${SOURCES} | bin
	cd src; zip -r -FS ../bin/simple-temporary-containers.zip * --exclude "test/*"

bin/stc-test.zip: ${SOURCES} ${TEST_SOURCES} | bin
	cd src; zip -r -FS ../bin/stc-test.zip *

clean:
	-rm -r bin

bin:
	mkdir bin

.PHONY: clean compile test
