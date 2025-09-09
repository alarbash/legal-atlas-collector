import { ArchiveOrgCollector } from "~/collectors/archive";

describe("ArchiveOrgCollector", () => {
  let collector: ArchiveOrgCollector;

  beforeEach(() => {
    collector = new ArchiveOrgCollector();
  });

  describe("getIdentifierFromUrl", () => {
    it("should extract identifier from valid Archive.org details URL", () => {
      const url = "https://archive.org/details/kuwaitalyawm";
      // @ts-expect-error - Testing private method
      const result = collector.getIdentifierFromUrl(url);
      
      expect(result).toBe("kuwaitalyawm");
    });

    it("should extract identifier from URL with additional path segments", () => {
      const url = "https://archive.org/details/some-collection/extra/path";
      // @ts-expect-error - Testing private method
      const result = collector.getIdentifierFromUrl(url);
      
      expect(result).toBe("some-collection");
    });

    it("should handle identifiers with special characters", () => {
      const url = "https://archive.org/details/collection-name_123";
      // @ts-expect-error - Testing private method
      const result = collector.getIdentifierFromUrl(url);
      
      expect(result).toBe("collection-name_123");
    });

    it("should return null for invalid Archive.org URL", () => {
      const url = "https://example.com/details/something";
      // @ts-expect-error - Testing private method
      const result = collector.getIdentifierFromUrl(url);
      
      expect(result).toBeNull();
    });

    it("should return null for Archive.org URL without details path", () => {
      const url = "https://archive.org/search?query=test";
      // @ts-expect-error - Testing private method
      const result = collector.getIdentifierFromUrl(url);
      
      expect(result).toBeNull();
    });

    it("should return null for malformed Archive.org details URL", () => {
      const url = "https://archive.org/details/";
      // @ts-expect-error - Testing private method
      const result = collector.getIdentifierFromUrl(url);
      
      expect(result).toBeNull();
    });

    it("should return null for non-URL strings", () => {
      const url = "not-a-url";
      // @ts-expect-error - Testing private method
      const result = collector.getIdentifierFromUrl(url);
      
      expect(result).toBeNull();
    });

    it("should return null for empty string", () => {
      const url = "";
      // @ts-expect-error - Testing private method
      const result = collector.getIdentifierFromUrl(url);
      
      expect(result).toBeNull();
    });
  });
});