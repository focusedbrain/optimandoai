/* Build 2b — HOST-side vsock client used by CrosvmProvider.
 *
 * The orchestrator is Node/Electron, which has no native AF_VSOCK. Rather than
 * add a native addon to the persistent orchestrator, CrosvmProvider spawns this
 * tiny static helper: it reads the job JSON from ITS stdin, connects to the
 * guest (cid,port) over AF_VSOCK (retrying until the guest listener is up or a
 * deadline — the VM-boot race), sends the job, half-closes, then relays the
 * JobResult from the socket to ITS stdout. No shared filesystem; pure socket.
 *
 * Build (static):  gcc -static -O2 -o vsock-host-client vsock-host-client.c
 * Usage:           vsock-host-client <cid> <port> [timeout_seconds]
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <time.h>
#include <sys/socket.h>
#include <linux/vm_sockets.h>

int main(int argc, char **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: %s <cid> <port> [timeout_s]\n", argv[0]);
    return 2;
  }
  unsigned int cid = (unsigned int)atoi(argv[1]);
  unsigned int port = (unsigned int)atoi(argv[2]);
  int timeout_s = (argc > 3) ? atoi(argv[3]) : 60;

  /* Slurp the whole job object from stdin. */
  size_t cap = 1 << 16, len = 0;
  char *buf = (char *)malloc(cap);
  if (!buf) { perror("malloc"); return 1; }
  ssize_t n;
  while ((n = read(0, buf + len, cap - len)) > 0) {
    len += (size_t)n;
    if (len == cap) { cap *= 2; buf = (char *)realloc(buf, cap); if (!buf) { perror("realloc"); return 1; } }
  }

  int s = -1;
  time_t deadline = time(NULL) + timeout_s;
  while (time(NULL) < deadline) {
    s = socket(AF_VSOCK, SOCK_STREAM, 0);
    if (s < 0) { perror("socket"); return 1; }
    struct sockaddr_vm addr;
    memset(&addr, 0, sizeof(addr));
    addr.svm_family = AF_VSOCK;
    addr.svm_cid = cid;
    addr.svm_port = port;
    if (connect(s, (struct sockaddr *)&addr, sizeof(addr)) == 0) break;
    close(s); s = -1;
    struct timespec ts = { 0, 200L * 1000L * 1000L };  /* 200ms */
    nanosleep(&ts, NULL);
  }
  if (s < 0) {
    fprintf(stderr, "vsock-host-client: connect timeout cid=%u port=%u\n", cid, port);
    return 1;
  }

  size_t off = 0;
  while (off < len) {
    n = write(s, buf + off, len - off);
    if (n <= 0) { perror("write job"); return 1; }
    off += (size_t)n;
  }
  shutdown(s, SHUT_WR);

  char rb[1 << 16];
  while ((n = read(s, rb, sizeof(rb))) > 0) {
    size_t o = 0;
    while (o < (size_t)n) {
      ssize_t w = write(1, rb + o, (size_t)n - o);
      if (w <= 0) { perror("write stdout"); return 1; }
      o += (size_t)w;
    }
  }
  close(s);
  free(buf);
  return 0;
}
