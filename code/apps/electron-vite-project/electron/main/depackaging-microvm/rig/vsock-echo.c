/* Build 2a — minimal vsock echo server for the GUEST side of the I/O proof.
 *
 * Proves the host<->guest channel is virtio-vsock (a socket; NO shared
 * filesystem). Listens on VMADDR_CID_ANY:<port>, accepts ONE connection, echoes
 * bytes back until newline, then exits. Build statically so the guest needs no
 * libc in the rootfs:  gcc -static -O2 -o vsock-echo vsock-echo.c
 *
 * This is spike scaffolding to confirm the channel — NOT the Build 2b job
 * transport (that frames the JobSpec/JobResult JSON over the same socket).
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <linux/vm_sockets.h>

int main(int argc, char **argv) {
  unsigned int port = (argc > 1) ? (unsigned int)atoi(argv[1]) : 1234u;
  int s = socket(AF_VSOCK, SOCK_STREAM, 0);
  if (s < 0) { perror("socket"); return 1; }

  struct sockaddr_vm addr;
  memset(&addr, 0, sizeof(addr));
  addr.svm_family = AF_VSOCK;
  addr.svm_cid = VMADDR_CID_ANY;
  addr.svm_port = port;

  if (bind(s, (struct sockaddr *)&addr, sizeof(addr)) < 0) { perror("bind"); return 1; }
  if (listen(s, 1) < 0) { perror("listen"); return 1; }
  fprintf(stderr, "vsock-echo: listening on cid=ANY port=%u\n", port);

  int c = accept(s, NULL, NULL);
  if (c < 0) { perror("accept"); return 1; }

  char buf[8192];
  ssize_t n;
  while ((n = read(c, buf, sizeof(buf))) > 0) {
    if (write(c, buf, (size_t)n) != n) { perror("write"); break; }
    if (buf[n - 1] == '\n') break;
  }
  close(c);
  close(s);
  fprintf(stderr, "vsock-echo: handled one connection, exiting\n");
  return 0;
}
